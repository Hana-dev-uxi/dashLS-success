const SUPABASE_URL = process.env.SUPABASE_URL || "https://hipxzbvvvjspvczjvopk.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY");

export default async (req) => {
  const pass = req.headers.get('x-staff-code');
  if (pass !== process.env.STAFF_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Accès refusé' }), { status: 403 });
  }

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/applications?select=*&order=created_at.desc`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
    }
  });

  const data = await dbRes.json();
  return new Response(JSON.stringify(data), { status: 200 });
};
