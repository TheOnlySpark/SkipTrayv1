import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-[2rem] p-8 md:p-12 shadow-sm text-slate-800">
      <Link to="/" className="inline-block mb-8 text-sm font-semibold text-indigo-600 hover:text-indigo-700">&larr; Back to Home</Link>
      <h1 className="text-3xl font-extrabold mb-8 text-slate-900 leading-tight">Privacy Policy</h1>

      <div className="space-y-6 text-sm md:text-base leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-400 uppercase tracking-wider text-xs">Last updated: {new Date().toLocaleDateString()}</p>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">1. Information We Collect</h2>
          <p>When you use SkipTray, we collect basic profile information (such as your name and ID number) and authentication details. We also collect data regarding your orders and application usage to ensure the smooth operation of the canteen pre-ordering system.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">2. How We Use Your Information</h2>
          <p>Your information is used strictly to authenticate your account, process your canteen orders, track potential no-shows, and provide you with relevant updates regarding your meal status.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">3. Third-Party Services</h2>
          <p>We use Supabase for identity, authentication, and database management. Your credentials are securely processed according to industry-standard security protocols. We do not sell or share your personal data with any unauthorized third parties.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">4. Data Security</h2>
          <p>We implement appropriate technical measures to protect your personal data against unauthorized processing, accidental loss, destruction, or damage.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">5. Contact Us</h2>
          <p>If you have any questions or concerns regarding this Privacy Policy, please contact the III administration or the canteen management team.</p>
        </section>
      </div>
    </div>
  );
}
