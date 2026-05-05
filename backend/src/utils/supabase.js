const { createClient } = require('@supabase/supabase-js');
const logger = require('../utils/logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY; // Using anon key for now, ideally service role

if (!supabaseUrl || !supabaseKey) {
  logger.warn('Supabase credentials missing. Supabase features will be limited.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
