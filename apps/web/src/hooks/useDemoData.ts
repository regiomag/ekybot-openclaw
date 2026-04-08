import { useTranslation } from '@/i18n/context';
import { 
  getDemoMessages, 
  getDemoAgents, 
  getDemoProjects, 
  getDemoTasks,
  DEMO_CHANNELS,
  DEMO_COSTS 
} from '@/data/demo-data';

/**
 * Hook to get demo data localized according to current locale
 */
export const useDemoData = () => {
  const { locale } = useTranslation();
  
  return {
    channels: DEMO_CHANNELS,
    messages: getDemoMessages(locale),
    agents: getDemoAgents(locale), 
    projects: getDemoProjects(locale),
    tasks: getDemoTasks(locale),
    costs: DEMO_COSTS,
  };
};