export type CampaignRow = {
  campaign_id: string;
  title: string;
  status: 'active' | 'archived';
  current_revision: number;
  current_state_json: string;
  head_event_hash: string;
  created_at: string;
  updated_at: string;
};

export type ReceiptRow = {
  request_hash: string;
  outcome_json: string;
};
