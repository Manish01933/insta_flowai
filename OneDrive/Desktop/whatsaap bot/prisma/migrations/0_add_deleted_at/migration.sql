-- Add deleted_at column to conversations table
ALTER TABLE conversations ADD COLUMN deleted_at TIMESTAMP;

-- Add deleted_at column to messages table
ALTER TABLE messages ADD COLUMN deleted_at TIMESTAMP;
