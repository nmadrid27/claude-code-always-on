/**
 * Supabase Edge Function: Semantic Search
 *
 * Performs semantic search across messages, goals, or user facts
 * using the query's embedding to find similar content.
 *
 * This function:
 * 1. Generates an embedding for the query text
 * 2. Searches the specified table for similar content
 * 3. Returns ranked results with similarity scores
 *
 * Usage:
 *   POST /functions/v1/semantic-search
 *   Body: { "query": "user's question", "table": "messages", "userId": 123 }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Generate embedding for query text
 */
async function generateQueryEmbedding(
  query: string,
  openaiKey: string,
): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-large",
      input: query,
      encoding_format: "float",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Perform semantic search using Supabase RPC function
 */
async function performSearch(
  supabase: ReturnType<typeof createClient>,
  functionName: string,
  queryEmbedding: number[],
  userId: number,
  limit: number,
  threshold: number,
) {
  return await supabase.rpc(functionName, {
    query_embedding: JSON.stringify(queryEmbedding),
    target_user_id: userId,
    limit_count: limit,
    similarity_threshold: threshold,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    // Parse request
    const {
      query,
      table,
      userId,
      limit = 10,
      threshold = 0.7,
    } = await req.json();

    if (!query || typeof query !== "string") {
      throw new Error("query is required and must be a string");
    }

    if (!userId || typeof userId !== "number") {
      throw new Error("userId is required and must be a number");
    }

    const validTables = ["messages", "goals", "user_facts"];
    if (!validTables.includes(table)) {
      throw new Error(`table must be one of: ${validTables.join(", ")}`);
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get OpenAI API key
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      throw new Error("OPENAI_API_KEY not configured");
    }

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query, openaiKey);

    // Map table to RPC function name
    const functionNames: Record<string, string> = {
      messages: "search_similar_messages",
      goals: "search_relevant_goals",
      user_facts: "search_relevant_facts",
    };

    const functionName = functionNames[table];
    if (!functionName) {
      throw new Error(`No search function defined for table: ${table}`);
    }

    // Perform search
    const { data, error } = await performSearch(
      supabase,
      functionName,
      queryEmbedding,
      userId,
      limit,
      threshold,
    );

    if (error) {
      throw new Error(`Search failed: ${error.message}`);
    }

    // Format response based on table type
    let results: Array<{
      id: string;
      content: string;
      similarity: number;
      metadata?: Record<string, unknown>;
    }>;

    if (table === "messages") {
      results = data.map((item: unknown) => ({
        id: (item as { id: string }).id,
        content: (item as { content: string }).content,
        similarity: (item as { similarity: number }).similarity,
        metadata: {
          role: (item as { role: string }).role,
          created_at: (item as { created_at: string }).created_at,
        },
      }));
    } else if (table === "goals") {
      results = data.map((item: unknown) => ({
        id: (item as { id: string }).id,
        content: `${(item as { title: string }).title}${
          (item as { description?: string }).description
            ? ": " + (item as { description: string }).description
            : ""
        }`,
        similarity: (item as { similarity: number }).similarity,
        metadata: {
          status: (item as { status: string }).status,
          priority: (item as { priority: number }).priority,
        },
      }));
    } else {
      // user_facts
      results = data.map((item: unknown) => ({
        id: (item as { id: string }).id,
        content: (item as { fact_text: string }).fact_text,
        similarity: (item as { similarity: number }).similarity,
        metadata: {
          type: (item as { fact_type: string }).fact_type,
          confidence: (item as { confidence: number }).confidence,
        },
      }));
    }

    return new Response(
      JSON.stringify({
        results,
        query,
        table,
        count: results.length,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error("Semantic search error:", error);

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
