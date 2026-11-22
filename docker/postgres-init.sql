-- Runs once on first postgres volume init.
-- The app uses product_video; n8n gets its own database.
SELECT 'CREATE DATABASE n8n' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'n8n')\gexec
