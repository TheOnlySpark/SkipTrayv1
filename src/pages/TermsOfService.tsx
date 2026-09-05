import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-[2rem] p-8 md:p-12 shadow-sm text-slate-800">
      <Link to="/" className="inline-block mb-8 text-sm font-semibold text-indigo-600 hover:text-indigo-700">&larr; Back to Home</Link>
      <h1 className="text-3xl font-extrabold mb-8 text-slate-900 leading-tight">Terms of Service</h1>
      
      <div className="space-y-6 text-sm md:text-base leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-400 uppercase tracking-wider text-xs">Last updated: {new Date().toLocaleDateString()}</p>
        
        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">1. Acceptance of Terms</h2>
          <p>By accessing or using SkipTray, you agree to be bound by these Terms of Service. This application is intended for authorized students, staff, and faculty of the institution.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">2. User Accounts & Responsibilities</h2>
          <p>You are responsible for maintaining the confidentiality of your login credentials. You agree that all orders placed under your account are your responsibility. Accounts found exploiting the system may be suspended.</p>
        </section>
        
        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">3. Ordering & Pickup Rules</h2>
          <ul className="list-disc pl-5 space-y-2 mt-2">
            <li>Orders must be placed at least 30 minutes in advance of the selected pickup slot.</li>
            <li>Repeated failure to collect your ordered meals (no-shows) will result in strikes. After 2 strikes, your account ordering privileges may be temporarily deactivated.</li>
            <li>Maximum ordering limits per person apply to ensure fair distribution.</li>
          </ul>
        </section>
        
        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">4. Service Modifications</h2>
          <p>The canteen administration reserves the right to modify menu items, prices, availability slots, and these terms at any time. We do not guarantee uninterrupted access to the application.</p>
        </section>

        <section>
          <h2 className="text-xl font-bold text-slate-800 mb-2">5. Disclaimers</h2>
          <p>SkipTray is provided "as is". While we strive for accuracy in menu availability, items may occasionally run out of stock after an order is placed. The administration will handle such exceptions at the counter.</p>
        </section>
      </div>
    </div>
  );
}
