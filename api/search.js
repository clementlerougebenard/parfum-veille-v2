module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ean, name } = req.body;
  if (!ean) return res.status(400).json({ error: 'EAN manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée' });

  const prompt = `Tu es un expert en veille prix parfums. 

Etape 1 : Recherche sur internet le parfum avec l'EAN "${ean}"${name ? ` ou le nom "${name}"` : ''}. Trouve d'abord son nom exact et sa marque.

Etape 2 : Recherche ce parfum sur TOUS les sites e-commerce qui le vendent dans le monde entier. Cherche avec des requêtes comme :
- "[nom du parfum] prix"
- "[nom du parfum] buy online"  
- "[nom du parfum] EAN ${ean}"
- "[nom du parfum] site:notino.fr OR site:sephora.fr OR site:douglas.de"
- "[nom du parfum] perfume price"

Collecte le maximum de prix sur le maximum de sites différents (objectif : 10+ sites).

Retourne UNIQUEMENT ce JSON sans markdown ni backticks :
{
  "product_name": "nom complet du parfum",
  "brand": "marque",
  "volume_ml": 75,
  "type": "Eau de Parfum",
  "found": true,
  "prices": [
    {
      "site": "Nom du site",
      "country": "FR",
      "currency": "EUR",
      "price": 69.90,
      "isOfficial": false,
      "url": "https://...",
      "in_stock": true
    }
  ],
  "notes": "remarques utiles"
}

Si le produit est introuvable : found:false, prices:[].`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 10 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Erreur API' });
    }

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'Réponse inattendue' });

    const result = JSON.parse(match[0]);
    if (result.prices) {
      result.prices = result.prices.map(p => ({
        ...p,
        priceEur: p.currency === 'GBP' ? p.price * 1.18 : p.currency === 'USD' ? p.price * 0.92 : p.price
      }));
    }
    return res.status(200).json(result);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
