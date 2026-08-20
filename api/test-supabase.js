import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {

  try {

    console.log("CLIPPY SUPABASE TEST START");

    const supabaseUrl = process.env.SUPABASE_URL;

    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl) {

      throw new Error("SUPABASE_URL is missing");

    }

    if (!supabaseKey) {

      throw new Error("SUPABASE_ANON_KEY is missing");

    }

    console.log("Supabase environment variables found");

    const supabase = createClient(

      supabaseUrl,

      supabaseKey

    );

    console.log("Supabase client created");

    // Test the messages table

    const { data, error } = await supabase

      .from("messages")

      .select("*")

      .limit(5);

    if (error) {

      console.error("SUPABASE ERROR:", error);

      return res.status(500).json({

        success: false,

        stage: "supabase_query",

        error: error.message,

        details: error

      });

    }

    console.log("SUPABASE CONNECTION SUCCESS");

    return res.status(200).json({

      success: true,

      message: "Clippy successfully connected to Supabase.",

      table: "messages",

      rows_found: data.length,

      data

    });

  } catch (error) {

    console.error("CLIPPY SUPABASE TEST FAILED:", error);

    return res.status(500).json({

      success: false,

      stage: "initialization",

      error: error.message

    });

  }

}
