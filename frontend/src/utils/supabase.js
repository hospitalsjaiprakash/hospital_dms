import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL || 'https://focsyzmswqgwiyynjtig.supabase.co';
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'sb_publishable_CU29C3-FGatl6RXnOzTxZw_CV-CqAwv';

export const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
