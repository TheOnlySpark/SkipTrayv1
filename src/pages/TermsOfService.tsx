import { Link } from 'react-router-dom';

export default function TermsOfService() {
  return (
    <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-[2rem] p-8 md:p-12 shadow-sm text-slate-800">
      <Link to="/" className="inline-block mb-8 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
        &larr; Back to Home
      </Link>
      
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold mb-4 text-slate-900 tracking-tight leading-tight">Terms of Service</h1>
        <p className="font-medium text-slate-500 uppercase tracking-wider text-sm">Last updated: {new Date().toLocaleDateString()}</p>
      </div>
      
      <div className="space-y-8 text-base leading-relaxed text-slate-600">
        
        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">1. Acceptance of Terms</h2>
          <p>
            By accessing, browsing, or using the SkipTray application, you agree to be bound by these Terms of Service. 
            This application is a closed-ecosystem service intended strictly for authorized students, staff, and faculty 
            of the institution. If you do not agree to these terms, you must refrain from using the platform.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">2. User Accounts & Responsibilities</h2>
          <p className="mb-3">Your account is personal and non-transferable. As a user, you agree to the following:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>You are responsible for maintaining the confidentiality of your login credentials and OTPs.</li>
            <li>You agree that all orders placed under your account are your sole responsibility.</li>
            <li>Accounts found exploiting the system, attempting unauthorized access, or sharing credentials may be permanently suspended.</li>
          </ul>
        </section>
        
        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">3. Ordering, Pickup, and Limitations</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Advance Ordering:</strong> Orders must be placed within the specified time limits before the beginning of your selected pickup slot.</li>
            <li><strong>Fair Use:</strong> To ensure equitable distribution of meals, the canteen administration may impose maximum order limits per user or per day.</li>
            <li><strong>OTP Verification:</strong> A valid One-Time Password (OTP) or QR code provided by the app must be presented at the counter to collect your order.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">4. The Strike System & No-Shows</h2>
          <p className="mb-3">SkipTray implements a strict anti-waste policy regarding uncollected food:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Failure to collect a prepared order by the end of your designated time slot will result in a "No-Show" strike against your account.</li>
            <li>Accumulating multiple strikes will result in an automatic, temporary suspension of your ordering privileges.</li>
            <li>Persistent violations may lead to permanent bans and administrative action from the institution.</li>
          </ul>
        </section>
        
        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">5. Service Modifications & Availability</h2>
          <p>
            The canteen administration reserves the right to modify menu items, adjust prices, change availability slots, 
            and update these terms at any time without prior notice. We strive to keep the system operational at all times 
            but do not guarantee uninterrupted access due to potential maintenance or server outages.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">6. Disclaimers & Limitation of Liability</h2>
          <p>
            SkipTray is provided "as is" and "as available". While we strive for absolute accuracy in menu availability, 
            ingredients, and pricing, discrepancies may occur. The administration is not liable for temporary menu unavailability, 
            unforeseen kitchen delays, or issues arising from technical malfunctions. Any order discrepancies will be handled 
            at the counter by the canteen staff.
          </p>
        </section>
      </div>
    </div>
  );
}
