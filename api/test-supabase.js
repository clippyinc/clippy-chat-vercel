export default async function handler(req, res) {

  try {

    const url = process.env.SUPABASE_URL;

    const key = process.env.SUPABASE_ANON_KEY;

    return res.status(200).json({

      success: true,

      supabase_url_exists: !!url,

      supabase_key_exists: !!key,

      supabase_url_length: url ? url.length : 0,

      supabase_key_length: key ? key.length : 0

    });

  } catch (error) {

    return res.status(500).json({

      success: false,

      error: error.message

    });

  }

}
