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
              <style>
                body { font-family: 'Space Grotesk', Arial, sans-serif; background-color: #000000; color: #ffffff; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background-color: #161616; border: 2px solid #2a2a2a; border-radius: 12px; padding: 40px; }
                .logo { font-size: 32px; font-weight: bold; text-align: center; margin-bottom: 10px; }
                .subtitle { text-align: center; color: #fbbf24; font-size: 12px; font-weight: bold; margin-bottom: 30px; }
                h1 { color: #ffffff; font-size: 24px; margin-bottom: 20px; }
                p { color: #d1d5db; line-height: 1.6; margin-bottom: 15px; }
                .social-links { text-align: center; margin: 30px 0; }
                .social-link { display: inline-block; margin: 0 10px; color: #ffffff; text-decoration: none; font-weight: bold; }
                .footer { text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="logo">MENTIONED</div>
                <div class="subtitle">DEVNET • MAINNET SOON</div>
                
                <h1>You're on the list! 🎉</h1>
                
                <p>Thanks for joining the Mentioned waitlist. You'll be among the first to know when we launch on mainnet.</p>
                
                <p>Mentioned is the first prediction market platform specifically built for mention markets. Trade on which words will be mentioned in speeches, podcasts, songs, and more.</p>
                
                <p><strong>What happens next?</strong></p>
                <ul style="color: #d1d5db; line-height: 1.8;">
                  <li>We'll notify you when mainnet launches</li>
                  <li>Get exclusive early access to new markets</li>
                  <li>Receive updates on platform development</li>
                </ul>
                
                <div class="social-links">
                  <a href="https://x.com/mentionedmarket" class="social-link">𝕏 Twitter</a>
                  <span style="color: #2a2a2a;">|</span>
                  <a href="https://discord.gg/gsD7vf6YRx" class="social-link">Discord</a>
                </div>
                
                <p>Want to try it out? Our <strong>devnet version</strong> is live now! Start trading with test SOL and get familiar with the platform.</p>
                
                <div class="footer">
                  <p>Questions? Join our <a href="https://discord.gg/gsD7vf6YRx" style="color: #fbbf24;">Discord community</a></p>
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

