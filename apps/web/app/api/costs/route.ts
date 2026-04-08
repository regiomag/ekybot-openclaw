import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { prisma } from '@/lib/prisma';
import { resolveRequestAuth } from '@/lib/request-auth';

/**
 * GET /api/costs - Fetch costs from local DB + optional Anthropic Admin API enhancement
 * Query params:
 *   - startDate: YYYY-MM-DD (default: start of current month)
 *   - endDate: YYYY-MM-DD (default: today)
 * 
 * Auth: Clerk session cookie OR x-agent-token header
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(request, { allowAgentToken: true });
    const authenticatedUser = authResult?.kind === 'user' ? authResult.user : null;
    const user = authenticatedUser
      ? await prisma.user.findUnique({
          where: { id: authenticatedUser.id },
          include: { gatewayConfig: true }
        })
      : null;
    
    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    // Parse date range
    const searchParams = request.nextUrl.searchParams;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const startDate = searchParams.get('startDate') || startOfMonth.toISOString().split('T')[0];
    const endDate = searchParams.get('endDate') || now.toISOString().split('T')[0];
    
    // Convert dates for database queries
    const startDateTime = new Date(startDate + 'T00:00:00Z');
    const endDateTime = new Date(endDate + 'T23:59:59Z');
    
    // Initialize aggregation objects
    const costsByModel: Record<string, number> = {};
    const dailyCostsMap: Record<string, number> = {};
    let totalCost = 0;
    let dataSource = 'local';

    // 🔧 STRATEGY 1: Get costs from local database (supports ALL providers)
    console.log('[Costs API] Fetching costs from local database...');
    
    const localUsage = await prisma.apiUsage.findMany({
      where: {
        userId: user.id,
        createdAt: {
          gte: startDateTime,
          lte: endDateTime
        }
      },
      include: {
        agent: {
          select: {
            name: true,
            model: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (localUsage.length > 0) {
      // Process local usage data
      for (const usage of localUsage) {
        const cost = usage.cost || 0;
        const model = usage.agent?.model || usage.model || 'unknown';
        const date = usage.createdAt.toISOString().split('T')[0];

        costsByModel[model] = (costsByModel[model] || 0) + cost;
        dailyCostsMap[date] = (dailyCostsMap[date] || 0) + cost;
        totalCost += cost;
      }
      
      console.log(`[Costs API] Local DB: ${localUsage.length} records, $${totalCost.toFixed(4)}`);
    }

    // 🔧 STRATEGY 2: Enhance with Anthropic Admin API if available
    const anthropicAdminKey = user?.gatewayConfig?.anthropicAdminKey;
    
    if (anthropicAdminKey && totalCost > 0) {
      console.log('[Costs API] Enhancing with Anthropic Admin API...');
      
      try {
        // ending_before is EXCLUSIVE — add 1 day to include the end date's costs
        const endDateObj = new Date(endDate + 'T00:00:00Z');
        endDateObj.setUTCDate(endDateObj.getUTCDate() + 1);
        const endingBefore = endDateObj.toISOString().split('T')[0];

        let nextPage: string | undefined = undefined;
        let pageCount = 0;
        const anthropicCosts: Record<string, number> = {};

        // Fetch Anthropic Admin API with pagination
        do {
          const params = new URLSearchParams({
            starting_at: startDate,
            ending_before: endingBefore,
            bucket_width: '1d',
            'group_by': 'model',
          });
          if (nextPage) params.set('next_page', nextPage);
          
          const apiUrl = `https://api.anthropic.com/v1/organizations/cost_report?${params}`;
          
          const response = await fetch(apiUrl, {
            headers: {
              'x-api-key': anthropicAdminKey,
              'anthropic-version': '2023-06-01',
            },
          });

          if (!response.ok) {
            console.warn('[Costs API] Anthropic API failed:', response.status);
            break; // Exit loop and continue with local data only
          }

          const data = await response.json();
          
          // Process buckets from Anthropic (more detailed than local)
          if (data.data && Array.isArray(data.data)) {
            for (const bucket of data.data) {
              if (bucket.cost_by_model && Array.isArray(bucket.cost_by_model)) {
                for (const modelCost of bucket.cost_by_model) {
                  const model = modelCost.model || 'unknown';
                  const cost = parseFloat(modelCost.cost_usd || '0');
                  
                  anthropicCosts[model] = (anthropicCosts[model] || 0) + cost;
                }
              }
            }
          }

          nextPage = data.has_more ? data.next_page : undefined;
          pageCount++;
        } while (nextPage && pageCount < 10); // Limit pages for performance

        // Replace Anthropic costs from Admin API (more accurate than local estimates)
        for (const [model, cost] of Object.entries(anthropicCosts)) {
          if (model.includes('claude') || model.includes('anthropic')) {
            // Replace local Anthropic costs with Admin API data
            const oldCost = costsByModel[model] || 0;
            costsByModel[model] = cost;
            totalCost = totalCost - oldCost + cost;
          }
        }
        
        console.log(`[Costs API] Enhanced with Anthropic Admin API: ${Object.keys(anthropicCosts).length} models`);
        dataSource = 'enhanced';
        
      } catch (anthropicError) {
        console.warn('[Costs API] Anthropic Admin API failed, using local data only:', anthropicError);
      }
    }

    // If no data from any source, return empty but valid response
    if (totalCost === 0) {
      return NextResponse.json({
        totalCost: 0,
        costsByModel: {},
        dailyCosts: [],
        period: { startDate, endDate },
        currency: 'USD',
        dataSource,
        message: 'Aucun coût trouvé pour cette période'
      });
    }

    // Convert daily costs map to sorted array
    const dailyCosts = Object.entries(dailyCostsMap)
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Format model names for display (support OpenAI + Anthropic + others)
    const formattedCostsByModel: Record<string, { cost: number; label: string }> = {};
    for (const [model, cost] of Object.entries(costsByModel)) {
      let label = model;
      
      // Anthropic models
      if (model.includes('opus')) label = 'Claude Opus';
      else if (model.includes('sonnet')) label = 'Claude Sonnet'; 
      else if (model.includes('haiku')) label = 'Claude Haiku';
      
      // OpenAI models
      else if (model.includes('gpt-4o')) label = 'GPT-4o';
      else if (model.includes('gpt-4')) label = 'GPT-4';
      else if (model.includes('gpt-3.5')) label = 'GPT-3.5';
      else if (model.includes('chatgpt')) label = 'ChatGPT';
      
      // Other providers
      else if (model.includes('gemini')) label = 'Gemini';
      else if (model.includes('deepseek')) label = 'DeepSeek';
      
      formattedCostsByModel[model] = { cost, label };
    }

    return NextResponse.json({
      totalCost,
      costsByModel: formattedCostsByModel,
      dailyCosts,
      period: { startDate, endDate },
      currency: 'USD',
      dataSource,
      recordCount: localUsage.length
    });

  } catch (error: any) {
    console.error('[Costs API] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Erreur serveur',
      dataSource: 'error'  
    }, { status: 500 });
  }
}
