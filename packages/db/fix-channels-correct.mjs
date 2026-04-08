import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const USER_ID = 'cmmek9m1n001dw8q4nqwcvvkv'; // Real internal DB user ID

async function main() {
  console.log('🔗 FIXING CHANNEL-AGENT ASSOCIATIONS (CORRECTED)');
  console.log('================================================\n');
  
  // Get agents and channels
  const agents = await prisma.agent.findMany({ where: { userId: USER_ID } });
  const channels = await prisma.channel.findMany({ where: { userId: USER_ID } });
  
  console.log(`📊 CURRENT STATE:`);
  console.log(`   Agents: ${agents.length}`);
  console.log(`   Channels: ${channels.length}\n`);
  
  console.log('📋 AVAILABLE CHANNELS:');
  channels.forEach(c => {
    console.log(`   "${c.name}" (ID: ${c.id})`);
  });
  console.log();
  
  console.log('🤖 AVAILABLE AGENTS:');
  agents.forEach(a => {
    console.log(`   "${a.name}" (${a.openclawAgentId}) (ID: ${a.id})`);
  });
  console.log();
  
  // Channel-agent mapping (using exact channel names from DB)
  const channelMapping = {
    '# general': 'Odin',
    '# ekybot-dev': 'Eki', 
    '# ekybot-marketing': 'Max',
    '# ekynavy-communication': 'Marina',
    '# ekynavy-marketing': 'Bosco',
    '# invest': 'Invest'
  };
  
  console.log('🔗 CREATING AGENT-CHANNEL LINKS:\n');
  
  let successCount = 0;
  
  for (const [channelName, agentName] of Object.entries(channelMapping)) {
    const channel = channels.find(c => c.name === channelName);
    const agent = agents.find(a => a.name === agentName);
    
    if (!channel) {
      console.log(`❌ Channel "${channelName}" not found`);
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
      
      console.log(`✅ "${channelName}" ↔ ${agentName}`);
      successCount++;
    } catch (error) {
      console.log(`❌ "${channelName}" ↔ ${agentName} failed: ${error.message}`);
    }
  }
  
  console.log(`\n🎉 ${successCount}/6 CHANNEL ASSOCIATIONS FIXED!`);
  
  // Verify results
  console.log('\n📊 VERIFICATION:');
  const updatedChannels = await prisma.channel.findMany({ 
    where: { userId: USER_ID },
    include: { agent: true }
  });
  
  updatedChannels.forEach(channel => {
    console.log(`   "${channel.name}" → ${channel.agent?.name || 'NONE'}`);
  });
  
  console.log('\n🔄 Refresh Ekybot to see the changes');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());