export type Plan = 'Free' | 'Basic' | 'Pro' | 'Premium';

export interface Subscription {
  id: string;
  user_id: string;
  plan: Plan;
  messages_used: number;
  automations_used: number;
  end_date: string;
}
