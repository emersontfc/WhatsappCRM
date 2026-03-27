export type Plan = 'Free' | 'Basic' | 'Pro' | 'Premium';

export interface PlanLimits {
  max_messages: number;
  max_contacts: number;
  max_automations: number;
  max_schedules: number;
  max_numbers: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  Free: { max_messages: 100, max_contacts: 50, max_automations: 1, max_schedules: 1, max_numbers: 1 },
  Basic: { max_messages: 1000, max_contacts: 500, max_automations: 5, max_schedules: 10, max_numbers: 2 },
  Pro: { max_messages: 5000, max_contacts: 2000, max_automations: 20, max_schedules: 50, max_numbers: 5 },
  Premium: { max_messages: 20000, max_contacts: 10000, max_automations: 100, max_schedules: 200, max_numbers: 10 },
};

export interface Subscription {
  id: string;
  user_id: string;
  plan: Plan;
  messages_used: number;
  automations_used: number;
  end_date: string;
}
