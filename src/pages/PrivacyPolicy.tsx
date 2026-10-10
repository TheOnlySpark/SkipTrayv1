import { Link } from 'react-router-dom';

export default function PrivacyPolicy() {
  return (
    <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-[2rem] p-8 md:p-12 shadow-sm text-slate-800">
      <Link to="/" className="inline-block mb-8 text-sm font-semibold text-indigo-600 hover:text-indigo-700 transition-colors">
        &larr; Back to Home
      </Link>
      
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold mb-4 text-slate-900 tracking-tight leading-tight">Privacy Policy</h1>
        <p className="font-medium text-slate-500 uppercase tracking-wider text-sm">Last updated: {new Date().toLocaleDateString()}</p>
      </div>

      <div className="space-y-8 text-base leading-relaxed text-slate-600">
        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">1. Introduction</h2>
          <p>
            Welcome to SkipTray. We respect your privacy and are committed to protecting your personal data. 
            This privacy policy informs you how we handle your personal information when you use our application, 
            and tells you about your privacy rights and how the law protects you.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">2. The Data We Collect About You</h2>
          <p className="mb-3">We may collect, use, store, and transfer different kinds of personal data about you, which we have grouped together as follows:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong className="text-slate-700">Identity Data:</strong> Includes your first name, last name, institutional ID number, and user role (student, staff, admin).</li>
            <li><strong className="text-slate-700">Contact Data:</strong> Includes your institutional email address used for account registration.</li>
            <li><strong className="text-slate-700">Transaction Data:</strong> Includes details about meal orders placed, times of pickup, and historical no-show records.</li>
            <li><strong className="text-slate-700">Technical Data:</strong> Includes internet protocol (IP) address, browser type and version, time zone setting, and device information used to access the app.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">3. How We Use Your Personal Data</h2>
          <p className="mb-3">We will only use your personal data when the law and institutional policies allow us to. Most commonly, we use it to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Register you as an authorized user and authenticate your login sessions securely.</li>
            <li>Process, track, and manage your canteen orders efficiently.</li>
            <li>Enforce ordering rules, including the strike system for failure to collect orders (no-shows).</li>
            <li>Notify you about critical changes to our terms, policies, or operating hours.</li>
            <li>Administer and protect our application, including troubleshooting and system maintenance.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">4. Data Security & Storage</h2>
          <p>
            Our infrastructure is backed by Supabase, employing industry-standard database security and Row Level Security (RLS). 
            This ensures that you can only access your own data, while staff and admins have role-based access limited to what is 
            necessary for operations. We have implemented appropriate technical and organizational measures to prevent your data 
            from being accidentally lost, used, or accessed in an unauthorized way.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">5. Data Retention</h2>
          <p>
            We will only retain your personal data for as long as necessary to fulfill the purposes we collected it for, 
            including satisfying any legal, accounting, or institutional reporting requirements. Order histories are periodically 
            anonymized or deleted at the end of the academic year, depending on institutional policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">6. Your Rights</h2>
          <p>
            Under certain circumstances, you have rights regarding your personal data, including the right to request access, 
            correction, or erasure of your information. If you wish to exercise any of these rights, please contact the administration.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-3">7. Contact Us</h2>
          <p>
            If you have any questions or concerns regarding this Privacy Policy or our data practices, please reach out directly 
            to the institution's administration desk or the canteen management team.
          </p>
        </section>
      </div>
    </div>
  );
}
