/**
 * AI aesthetic evaluation using Gemini 2.5 Flash
 */

// AI evaluation function using Gemini
export async function evaluateAesthetics(imageUrl, address, env) {
  // Helper: convert ArrayBuffer to base64 in Workers
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // avoid call stack limits
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  async function ensureBase64(imageInput) {
    if (!imageInput) return null;
    // Already a data URL
    if (typeof imageInput === 'string' && imageInput.startsWith('data:image/')) {
      const commaIdx = imageInput.indexOf(',');
      return imageInput.substring(commaIdx + 1);
    }
    // Heuristic: looks like base64 (no protocol, long, only base64 chars)
    if (typeof imageInput === 'string' && !/^https?:\/\//i.test(imageInput) && /^[A-Za-z0-9+/=]+$/.test(imageInput)) {
      return imageInput;
    }
    // Otherwise fetch the remote image URL and convert
    if (typeof imageInput === 'string' && /^https?:\/\//i.test(imageInput)) {
      const resp = await fetch(imageInput);
      if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
      const buf = await resp.arrayBuffer();
      return arrayBufferToBase64(buf);
    }
    return null;
  }

  try {
    const base64Data = await ensureBase64(imageUrl);
    if (!base64Data) {
      throw new Error('Image data unavailable');
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are an expert architectural and urban design critic evaluating the aesthetic quality of street scenes. 

Analyze this Street View image of ${address} and provide:

1. **Aesthetic Review** (2-3 sentences): Describe the architectural style, building condition, street environment, and overall visual appeal. Consider factors like:
   - Architectural quality and style
   - Road and pavement materials can make a surprising difference to the overall aesthetic. Brick or flagstone can greatly improve a street scene compared to concrete or asphalt.
   - Building maintenance and appearance
   - Street cleanliness and landscaping
   - Visual harmony and composition
   - Overall neighborhood character

2. **Beauty Score** (1-10): Rate the overall aesthetic appeal where:
   - 1-2: Bad (ugly, neglected, or visually jarring). Eg. industrial sites, derelict buildings
   - 3-4: Lackluster (bland, uninspiring). Eg. Grim housing blocks, dirty steets
   - 5-6: Okay (pleasant but unremarkable). Eg. Unadorned houses, bland modern developments
   - 7-8: Good (attractive, well-designed). Eg. Ornamented houses, greenery, flagstone paths
   - 9-10: Excellent (beautiful, exquisite) Eg. Ornate facades, colourful gardens, well composed street scenes

Be fair and open minded, while maintaining high standards. Don't be afraid to use the full range of the scale.

Format your response EXACTLY as:
REVIEW: [Your 2-3 sentence review here]
SCORE: [Single number from 1-10]

Example 1:
REVIEW: A well-maintained Victorian terrace with original period features and attractive brickwork. The street is clean with mature trees providing natural beauty, though some modern additions slightly detract from the historic character.
SCORE: 7

Example 2:
REVIEW: A bland residential block with integrated ground-level garages dominating the streetscape. While appearing adequately maintained, the design lacks visual interest and is devoid of notable aesthetic appeal or landscaping.
SCORE: 2`
              },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Data
                }
              }
            ]
          }
        ]
      })
    });

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // Parse the response (enhanced version matching Python)
    let reviewMatch = text.match(/REVIEW:\s*(.+?)(?=SCORE:|$)/si);
    let scoreMatch = text.match(/SCORE:\s*(\d+(?:\.\d+)?)/i);
    
    let review = reviewMatch ? reviewMatch[1].trim() : null;
    let score = null;
    
    if (scoreMatch) {
      score = parseFloat(scoreMatch[1]);
      // Clamp score to 1-10 range
      score = Math.max(1.0, Math.min(10.0, score));
    }
    
    // If structured parsing fails, try to extract any number in 1-10 range
    if (score === null) {
      const numberMatches = text.match(/\b(\d+(?:\.\d+)?)\b/g);
      if (numberMatches) {
        for (const match of numberMatches) {
          const candidate = parseFloat(match);
          if (candidate >= 1.0 && candidate <= 10.0) {
            score = candidate;
            break;
          }
        }
      }
    }
    
    return {
      beauty: score,
      blurb: review,
      raw_response: text,
      parsing_successful: review !== null && score !== null
    };
  } catch (error) {
    console.error('AI evaluation failed:', error);
    return { beauty: null, blurb: null, error: error.message };
  }
}