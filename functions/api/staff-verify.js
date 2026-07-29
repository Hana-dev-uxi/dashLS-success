export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const { password } = await req.json();
  if (password === process.env.STAFF_PASSWORD) {
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  return new Response(JSON.stringify({ error: 'Mot de passe incorrect' }), { status: 401 });
};