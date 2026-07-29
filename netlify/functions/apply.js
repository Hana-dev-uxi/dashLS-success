import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY");
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function uploadToSupabase(file) {
  const fileExt = path.extname(file.name) || '.bin';
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}${fileExt}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/student-docs/${fileName}`;

  const buffer = await file.arrayBuffer();

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': file.type || 'application/octet-stream'
    },
    body: buffer
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Storage upload failed: ${errText}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/student-docs/${fileName}`;
}

async function generateGroqSummary(studentName, notes) {
  if (!GROQ_API_KEY) return `Dossier soumis par ${studentName}.`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'Tu es un assistant d admissions universitaires. Rédige un résumé synthétique et concis en 3 phrases maximum du profil du candidat.' },
          { role: 'user', content: `Candidat: ${studentName}. Remarques/Motivations: ${notes}` }
        ]
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || `Dossier soumis par ${studentName}.`;
  } catch (e) {
    return `Candidat: ${studentName}`;
  }
}

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  try {
    const formData = await req.formData();
    const name = formData.get('name');
    const email = formData.get('email');
    const phone = formData.get('phone');
    const notes = formData.get('notes');
    const files = formData.getAll('documents');

    const uploadedDocUrls = [];
    for (const file of files) {
      if (file && typeof file === 'object' && file.name && file.size > 0) {
        const publicUrl = await uploadToSupabase(file);
        uploadedDocUrls.push(publicUrl);
      }
    }

    const aiSummary = await generateGroqSummary(name, notes || '');

    const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        student_name: name,
        student_email: email,
        student_phone: phone || null,
        notes: notes || '',
        document_urls: uploadedDocUrls,
        ai_summary: aiSummary
      })
    });

    const data = await dbRes.json();
    if (!dbRes.ok) {
      return new Response(JSON.stringify({ error: `Database error: ${data.message || JSON.stringify(data)}` }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const appRecord = data[0];
    if (!appRecord) {
      throw new Error("Database inserted row but returned no record.");
    }

    const urlObj = new URL(req.url);
    const trackingToken = appRecord.access_token || appRecord.id;
    const trackingUrl = `${urlObj.origin}/?token=${trackingToken}`;

    await sendEmail(email, "Confirmation de votre dossier de candidature", 
      `<p>Bonjour ${name},</p><p>Votre candidature a bien été transmise.</p><p>Vous pouvez suivre son avancement via ce lien : <a href="${trackingUrl}">${trackingUrl}</a></p>`
    );

    return new Response(JSON.stringify({ success: true, token: trackingToken }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
};
