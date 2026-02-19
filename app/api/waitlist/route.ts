import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

// Only create Supabase client if env vars are present
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  : null

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Invalid email address' },
        { status: 400 }
      )
    }

    // Check if Supabase is configured
    if (!supabase) {
      return NextResponse.json(
        { error: 'Waitlist service not configured' },
        { status: 503 }
      )
    }

    // Save to Supabase
    const { data, error } = await supabase
      .from('waitlist')
      .insert([{ email, created_at: new Date().toISOString() }])
      .select()

    if (error) {
      // Check if email already exists
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Email already registered' },
          { status: 409 }
        )
      }
      console.error('Supabase error:', error)
      return NextResponse.json(
        { error: 'Failed to save email' },
        { status: 500 }
      )
    }

    // Send confirmation email
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
      })

      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: email,
        subject: 'Welcome to Mentioned - You\'re on the Waitlist!',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
              <style>
                body { font-family: 'Plus Jakarta Sans', Arial, sans-serif; background-color: #ffffff; color: #1a1a1a; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 40px; }
                .logo { text-align: center; margin-bottom: 10px; }
                .logo img { height: 60px; width: auto; }
                .subtitle { text-align: center; color: #a16207; font-size: 12px; font-weight: bold; margin-bottom: 30px; }
                h1 { color: #1a1a1a; font-size: 24px; margin-bottom: 20px; font-weight: 700; }
                p { color: #4b5563; line-height: 1.6; margin-bottom: 15px; }
                .social-links { text-align: center; margin: 30px 0; }
                .social-link { display: inline-block; margin: 0 10px; color: #1a1a1a; text-decoration: none; font-weight: bold; }
                .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 30px; }
              </style>
            </head>
            <body style="background-color: #ffffff; margin: 0; padding: 20px;">
              <div class="container" style="background-color: #ffffff;">
                <div class="logo">
                  <img src="https://mentioned.market/src/img/email_black_icon.png" alt="Mentioned" style="height: 60px; width: auto;" />
                </div>
                <div class="subtitle">DEVNET • MAINNET SOON</div>

                <h1>You're on the list!</h1>

                <p>Thanks for joining the Mentioned waitlist. You'll be among the first to know when we launch on mainnet.</p>

                <p>Mentioned is the first prediction market platform specifically built for mention markets. Trade on which words will be mentioned in speeches, podcasts, songs, and more.</p>

                <p><strong style="color: #1a1a1a;">What happens next?</strong></p>
                <ul style="color: #4b5563; line-height: 1.8;">
                  <li>We'll notify you when mainnet launches</li>
                  <li>Get exclusive early access to new markets</li>
                  <li>Receive updates on platform development</li>
                </ul>

                <div class="social-links">
                  <a href="https://x.com/mentionedmarket" class="social-link" style="color: #1a1a1a;">𝕏 Twitter</a>
                  <span style="color: #e5e5e5;">|</span>
                  <a href="https://discord.gg/gsD7vf6YRx" class="social-link" style="color: #1a1a1a;">Discord</a>
                </div>

                <p>Want to try it out? Our <strong style="color: #1a1a1a;">devnet version</strong> is live now! Start trading with test SOL and get familiar with the platform.</p>

                <div class="footer">
                  <p>Questions? Join our <a href="https://discord.gg/gsD7vf6YRx" style="color: #a16207;">Discord community</a></p>
                </div>
              </div>
            </body>
          </html>
        `,
      }

      await transporter.sendMail(mailOptions)
    } catch (emailError) {
      console.error('Email error:', emailError)
      // Don't fail the request if email fails - the email is saved
    }

    return NextResponse.json(
      { message: 'Successfully added to waitlist', data },
      { status: 200 }
    )
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

