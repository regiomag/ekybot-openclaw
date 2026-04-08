import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const USER_ID = 'cmmek9m1n001dw8q4nqwcvvkv'; // Real internal DB user ID

async function main() {
  console.log('🔗 FIXING CHANNEL-AGENT ASSOCIATIONS');
  console.log('====================================\n');
  
  // Get agents and channels
  const agents = await prisma.agent.findMany({ where: { userId: USER_ID } });
  const channels = await prisma.channel.findMany({ where: { userId: USER_ID } });
  
  console.log(`📊 CURRENT STATE:`);
  console.log(`   Agents: ${agents.length}`);
  console.log(`   Channels: ${channels.length}\n`);
  
  // Channel-agent mapping
  const channelMapping = {
    'general': 'Odin',
    'ekybot-dev': 'Eki', 
    'ekybot-marketing': 'Max',
    'ekynavy-communication': 'Marina',
    'ekynavy-marketing': 'Bosco',
    'invest': 'Invest'
  };
  
  console.log('🔗 CREATING AGENT-CHANNEL LINKS:\n');
  
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
      // Update channel to point to agent
      await prisma.channel.update({
        where: { id: channel.id },
        data: { agentId: agent.id }
      });
      
      console.log(`✅ #${channelName} ↔ ${agentName} (${agent.id})`);
    } catch (error) {
      console.log(`❌ #${channelName} ↔ ${agentName} failed: ${error.message}`);
    }
  }
  
  console.log('\n🎉 CHANNEL ASSOCIATIONS FIXED!');
  
  // Verify results
  console.log('\n📊 VERIFICATION:');
  const updatedChannels = await prisma.channel.findMany({ 
    where: { userId: USER_ID },
    include: { agent: true }
  });
  
  updatedChannels.forEach(channel => {
    console.log(`   #${channel.name} → ${channel.agent?.name || 'NONE'}`);
  });
  
  console.log('\n🔄 Refresh Ekybot to see the changes');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());