const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-staff-code',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const pass = request.headers.get('x-staff-code');
  if (pass !== env.STAFF_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Accès refusé' }), { 
      status: 403, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  const supabaseUrl = env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
  const supabaseKey = env.SUPABASE_ANON_KEY;

  const dbRes = await fetch(`${supabaseUrl}/rest/v1/applications?select=*&order=created_at.desc`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  });

  const data = await dbRes.json();
  
  if (!dbRes.ok) {
    return new Response(JSON.stringify(data), { 
      status: dbRes.status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
  
  return new Response(JSON.stringify(data), { 
    status: 200, 
    headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
  });
}
