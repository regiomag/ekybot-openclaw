import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const USER_ID = 'cmmek9m1n001dw8q4nqwcvvkv'; // Real internal DB user ID

async function main() {
  console.log('🔧 FIXING ASSOCIATIONS');
  console.log('======================\n');
  
  // Get all user data
  const projects = await prisma.project.findMany({ where: { userId: USER_ID } });
  const agents = await prisma.agent.findMany({ where: { userId: USER_ID } });
  const channels = await prisma.channel.findMany({ where: { userId: USER_ID } });
  
  console.log(`📊 CURRENT STATE:`);
  console.log(`   Projects: ${projects.length}`);
  console.log(`   Agents: ${agents.length}`);
  console.log(`   Channels: ${channels.length}\n`);
  
  // Project mapping (based on logical grouping)
  const projectMapping = {
    'EkyBot': ['Odin', 'Eki', 'Atlas', 'Babel'],
    'EkyNavy': ['Marina', 'Bosco'],
    'Invest': ['Invest', 'Max']
  };
  
  console.log('🔗 ASSIGNING AGENTS TO PROJECTS:\n');
  
  for (const [projectName, agentNames] of Object.entries(projectMapping)) {
    const project = projects.find(p => p.name === projectName);
    if (!project) {
      console.log(`❌ Project ${projectName} not found`);
      continue;
    }
    
    console.log(`📁 ${projectName} (${project.id}):`);
    
    for (const agentName of agentNames) {
      const agent = agents.find(a => a.name === agentName);
      if (!agent) {
        console.log(`   ❌ Agent ${agentName} not found`);
        continue;
      }
      
      try {
        await prisma.agent.update({
          where: { id: agent.id },
          data: { projectId: project.id }
        });
        console.log(`   ✅ ${agentName} → ${projectName}`);
      } catch (error) {
        console.log(`   ❌ ${agentName} failed: ${error.message}`);
      }
    }
    console.log();
  }
  
  console.log('🔗 CREATING AGENT-CHANNEL ASSIGNMENTS:\n');
  
  // Channel-agent mapping
  const channelMapping = {
    'general': 'Odin',
    'ekybot-dev': 'Eki', 
    'ekybot-marketing': 'Max',
    'ekynavy-communication': 'Marina',
    'ekynavy-marketing': 'Bosco',
    'invest': 'Invest'
  };
  
  // Clear existing assignments first
  await prisma.agentChannelAssignment.deleteMany();
  console.log('🧹 Cleared existing assignments');
  
  for (const [channelName, agentName] of Object.entries(channelMapping)) {
    const channel = channels.find(c => c.name === channelName);
    const agent = agents.find(a => a.name === agentName);
    
    if (!channel) {
      console.log(`❌ Channel #${channelName} not found`);
      continue;
    }
    
    if (!agent) {
      console.log(`❌ Agent ${agentName} not found`);
      continue;
    }
    
    try {
      // Create assignment
      await prisma.agentChannelAssignment.create({
        data: {
          agentId: agent.id,
          channelId: channel.id
        }
      });
      
      // Update channel to point to agent
      await prisma.channel.update({
        where: { id: channel.id },
        data: { agentId: agent.id }
      });
      
      console.log(`✅ #${channelName} ↔ ${agentName}`);
    } catch (error) {
      console.log(`❌ #${channelName} ↔ ${agentName} failed: ${error.message}`);
    }
  }
  
  console.log('\n🎉 ASSOCIATIONS FIXED!');
  console.log('🔄 Refresh Ekybot to see the changes');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());