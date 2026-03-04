/**
 * Supabase Edge Function: Generate Embeddings
 *
 * This function generates OpenAI embeddings without exposing the API key.
 * The API key is stored as a secret in Supabase (OPENAI_API_KEY).
 *
 * Usage:
 *   POST /functions/v1/embeddings
 *   Body: { "texts": ["text1", "text2"], "model": "text-embedding-3-large" }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS headers for browser requests
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * OpenAI embedding response structure
 */
interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generates embeddings using OpenAI API
 */
async function generateEmbeddings(
  texts: string[],
  apiKey: string,
  model = "text-embedding-3-large",
): Promise<OpenAIEmbeddingResponse> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  return response.json();
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify request is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Parse request body
    const { texts, model = "text-embedding-3-large" } = await req.json();

    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error("texts must be a non-empty array");
    }

    // Validate model
    if (
      model !== "text-embedding-3-small" &&
      model !== "text-embedding-3-large"
    ) {
      throw new Error("Invalid model. Use text-embedding-3-small or text-embedding-3-large");
    }

    // Get OpenAI API key from environment
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    // Generate embeddings
    const data = await generateEmbeddings(texts, openaiKey, model);

    // Sort results by index to ensure order matches input
    const sorted = [...data.data].sort((a, b) => a.index - b.index);

    const dimensions = model === "text-embedding-3-large" ? 3072 : 1536;

    return new Response(
      JSON.stringify({
        embeddings: sorted.map((item) => item.embedding),
        model,
        dimensions,
        usage: data.usage,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Embeddings error:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
