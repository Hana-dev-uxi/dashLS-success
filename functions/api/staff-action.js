const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-staff-code',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function sendEmail(to, subject, html, env) {
  if (!env.RESEND_API_KEY) return;
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Admissions <admissions@lssuccess.ma>',
      to: [to],
      subject,
      html
    })
  });
}

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

  try {
    const { id, action, staff_notes } = await request.json();
    const supabaseUrl = env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
    const supabaseKey = env.SUPABASE_ANON_KEY;

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/applications?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ status: action, staff_notes, updated_at: new Date().toISOString() })
    });

    const data = await dbRes.json();
    const appRecord = data[0];

    let statusFr = action === 'approved' ? 'Approuvé' : (action === 'rejected' ? 'Refusé' : 'Information requise');

    if (appRecord) {
      await sendEmail(appRecord.student_email, `Mise à jour de votre dossier : ${statusFr}`,
        `<p>Bonjour ${appRecord.student_name},</p><p>Le statut de votre dossier est désormais : <strong>${statusFr}</strong>.</p>${staff_notes ? `<p>Note de l administration : ${staff_notes}</p>` : ''}`,
        env
      );
    }

    return new Response(JSON.stringify({ success: true }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}
