const SUPABASE_URL = process.env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY");
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) return;
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
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

export default async (req) => {
  const pass = req.headers.get('x-staff-code');
  if (pass !== process.env.STAFF_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403 });
  }

  const { id, action, staff_notes } = await req.json();

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
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
      `<p>Bonjour ${appRecord.student_name},</p><p>Le statut de votre dossier est désormais : <strong>${statusFr}</strong>.</p>${staff_notes ? `<p>Note de l administration : ${staff_notes}</p>` : ''}`
    );
  }

  return new Response(JSON.stringify({ success: true }), { status: 200 });
};