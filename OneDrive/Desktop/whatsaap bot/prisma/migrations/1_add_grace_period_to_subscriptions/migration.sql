-- Add grace_period_end_date column to subscriptions table
ALTER TABLE subscriptions ADD COLUMN grace_period_end_date TIMESTAMP;

-- Create index on grace_period_end_date for efficient queries
CREATE INDEX idx_subscriptions_grace_period_end_date ON subscriptions(grace_period_end_date);
