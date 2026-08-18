import { createClient } from '@supabase/supabase-js';

function send(response, status, body) {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(body);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return send(response, 405, { ok: false, error: 'method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.authorization !== `Bearer ${cronSecret}`) {
    return send(response, 401, { ok: false, error: 'unauthorized' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  // The website and POS can share this repository. A deployment without the
  // server-only Supabase variables simply skips the heartbeat.
  if (!supabaseUrl || !supabaseSecretKey) {
    return send(response, 200, { ok: true, skipped: true });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { error } = await supabase
      .from('business_settings')
      .select('business_id')
      .limit(1);

    if (error) throw error;

    return send(response, 200, {
      ok: true,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Supabase keepalive failed', error);
    return send(response, 502, { ok: false, error: 'database check failed' });
  }
}
