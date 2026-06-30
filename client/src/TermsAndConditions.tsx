import React from 'react';

const EFFECTIVE_DATE = 'June 24, 2026';
const COMPANY_NAME   = 'The Loyaly';
const COMPANY_EMAIL  = 'support@theloyaly.com';
const GOVERNING_LAW  = 'England and Wales';

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-4">
            <img src="/black.png" alt="The Loyaly" className="h-8 w-auto object-contain" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms and Conditions of Service</h1>
          <p className="text-sm text-gray-500">Effective Date: {EFFECTIVE_DATE} &nbsp;|&nbsp; Version 1.0</p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">

        {/* Preamble */}
        <section>
          <p className="text-sm leading-7 text-gray-700">
            PLEASE READ THESE TERMS AND CONDITIONS OF SERVICE (hereinafter, the &ldquo;<strong>Agreement</strong>&rdquo;
            or &ldquo;<strong>Terms</strong>&rdquo;) CAREFULLY BEFORE ACCESSING, REGISTERING FOR, OR USING THE
            THE LOYALY PLATFORM (the &ldquo;<strong>Platform</strong>&rdquo;). BY CLICKING &ldquo;I AGREE,&rdquo; BY
            COMPLETING THE REGISTRATION PROCESS, OR BY ACCESSING OR USING ANY PORTION OF THE PLATFORM, YOU
            (&ldquo;<strong>User</strong>,&rdquo; &ldquo;<strong>You</strong>,&rdquo; OR &ldquo;<strong>Your</strong>&rdquo;)
            ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND UNCONDITIONALLY AGREE TO BE LEGALLY BOUND BY THIS
            AGREEMENT IN ITS ENTIRETY. IF YOU DO NOT AGREE TO THESE TERMS, YOU MUST IMMEDIATELY CEASE ALL USE
            OF THE PLATFORM AND CLOSE YOUR ACCOUNT.
          </p>
          <p className="text-sm leading-7 text-gray-700 mt-4">
            This Agreement constitutes a legally binding contract between You and <strong>{COMPANY_NAME}</strong>
            (hereinafter, the &ldquo;<strong>Company</strong>,&rdquo; &ldquo;<strong>We</strong>,&rdquo; &ldquo;<strong>Us</strong>,&rdquo;
            or &ldquo;<strong>Our</strong>&rdquo;). This Agreement governs Your access to and use of The Loyaly
            Software-as-a-Service platform, including all associated websites, APIs, mobile applications, dashboards,
            customer-facing portals, WhatsApp messaging pipelines, analytics tooling, loyalty programme infrastructure,
            and any other products or services offered by the Company (collectively, the &ldquo;<strong>Services</strong>&rdquo;).
          </p>
        </section>

        <hr className="border-gray-200" />

        {/* 1 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">1. Definitions</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            For the purposes of this Agreement, the following terms shall have the meanings ascribed to them below:
          </p>
          <ul className="space-y-2 text-sm leading-7 text-gray-700 list-none pl-0">
            {[
              ['"Account"', 'means the unique account created by a Tenant or End Customer to access and use the Services.'],
              ['"Business Data"', 'means all data, content, materials, and information submitted by a Tenant to the Platform in connection with the operation of their business, including but not limited to customer records, transaction histories, loyalty configurations, and campaign content.'],
              ['"End Customer"', 'means any natural person who interacts with the Platform as a customer of a Tenant, including through the Customer Loyalty Portal.'],
              ['"Platform"', 'means The Loyaly software platform and all associated Services as described in the preamble.'],
              ['"Tenant"', 'means any business entity or individual that registers for, accesses, or uses the Platform in a business capacity, including Tenant Owners, Branch Managers, and Marketing Staff as defined within the role hierarchy.'],
              ['"Third-Party Services"', 'means external platforms, APIs, gateways, and services integrated with or used by the Platform, including but not limited to WhatsApp (Meta Platforms, Inc.), Stripe, Inc., Neon Technologies, Upstash, OpenAI, and any messaging gateway providers.'],
              ['"User Data"', 'means collectively, Business Data and any personal data of End Customers processed through the Platform.'],
            ].map(([term, def]) => (
              <li key={term as string}>
                <strong>{term}</strong> {def}
              </li>
            ))}
          </ul>
        </section>

        {/* 2 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">2. Acceptance of Terms and Modifications</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>2.1 Binding Agreement.</strong> Your access to and use of the Services constitutes Your unconditional
            acceptance of this Agreement and all policies and guidelines incorporated herein by reference, including Our
            Privacy Policy. If You are entering into this Agreement on behalf of a business entity, You represent and
            warrant that You have the full legal authority to bind that entity to this Agreement, and Your acceptance
            of these Terms constitutes acceptance on behalf of that entity.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>2.2 Modifications.</strong> The Company reserves the absolute and unconditional right to modify,
            amend, update, or replace any portion of this Agreement at any time, in its sole and unfettered discretion,
            without prior notice to You. Any such modifications shall become effective immediately upon posting to the
            Platform or upon electronic notification to the email address associated with Your Account. Your continued
            use of the Platform following such notification or posting shall constitute Your conclusive acceptance of
            the modified Terms. It is Your sole responsibility to review this Agreement periodically. If You object to
            any modification, Your sole and exclusive remedy is to immediately discontinue use of the Platform and
            terminate Your Account.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>2.3 Supersession.</strong> This Agreement supersedes all prior agreements, representations,
            warranties, undertakings, and understandings between the parties with respect to the subject matter hereof,
            whether written or oral, express or implied.
          </p>
        </section>

        {/* 3 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">3. Eligibility and Account Registration</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>3.1 Age and Capacity.</strong> The Services are intended solely for individuals and entities that
            are of legal age to form binding contracts under applicable law. By accessing the Services, You represent
            and warrant that You are at least eighteen (18) years of age, possess the legal authority, right, and
            freedom to enter into this Agreement as a binding obligation, and are not prohibited from doing so under
            any applicable law.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>3.2 Account Security.</strong> You are solely and exclusively responsible for maintaining the
            confidentiality of Your Account credentials, including all passwords and authentication tokens. You agree
            to accept full responsibility for all activities that occur under Your Account, whether or not authorised
            by You. You agree to notify the Company immediately of any actual or suspected unauthorised use of Your
            Account. The Company shall bear no liability whatsoever for any loss, damage, or liability arising from
            Your failure to comply with this obligation.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>3.3 Accuracy of Information.</strong> You agree to provide accurate, current, and complete
            information during the registration process and to update such information as necessary to maintain its
            accuracy. The Company reserves the right to suspend or terminate Your Account if any information provided
            is found to be inaccurate, false, outdated, or incomplete.
          </p>
        </section>

        {/* 4 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">4. Permitted Use and Restrictions</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>4.1 Licence Grant.</strong> Subject to Your compliance with this Agreement and timely payment of
            applicable fees, the Company grants You a limited, non-exclusive, non-transferable, non-sublicensable,
            revocable licence to access and use the Services solely for Your legitimate internal business purposes
            during the applicable subscription term.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>4.2 Prohibited Conduct.</strong> You shall not, and shall not permit any third party to:
          </p>
          <ol className="list-[lower-alpha] pl-6 space-y-2 text-sm leading-7 text-gray-700">
            <li>reverse-engineer, decompile, disassemble, or otherwise attempt to derive the source code, algorithms, or underlying structure of the Platform;</li>
            <li>use the Services to transmit any unsolicited commercial communications, spam, phishing messages, or any content that violates applicable anti-spam legislation;</li>
            <li>use the Services in any manner that violates applicable local, national, or international laws or regulations, including without limitation the UK General Data Protection Regulation (&ldquo;UK GDPR&rdquo;), the Data Protection Act 2018, the Privacy and Electronic Communications Regulations 2003, and any analogous legislation;</li>
            <li>use the Services to send communications to individuals who have not provided valid, freely given, and documented marketing consent in accordance with applicable law;</li>
            <li>attempt to gain unauthorised access to any portion or feature of the Platform, or any other systems or networks connected to the Platform;</li>
            <li>resell, sublicense, or commercialise the Services or any component thereof without the Company&rsquo;s express prior written consent;</li>
            <li>use automated means, bots, scrapers, or similar data gathering and extraction tools on the Platform without the Company&rsquo;s express prior written consent.</li>
          </ol>
        </section>

        {/* 5 – DISCLAIMER */}
        <section className="bg-red-50 border border-red-200 rounded-xl p-6">
          <h2 className="text-xl font-bold text-red-800 mb-4">5. Disclaimer of Warranties</h2>
          <p className="text-sm leading-7 text-red-900 mb-3 font-semibold uppercase tracking-wide">
            THE SERVICES ARE PROVIDED ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; BASIS, WITHOUT ANY
            WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE.
          </p>
          <p className="text-sm leading-7 text-red-900 mb-3">
            <strong>5.1</strong> TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE COMPANY HEREBY EXPRESSLY
            DISCLAIMS ALL WARRANTIES, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING BUT NOT LIMITED TO
            ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT,
            ACCURACY, RELIABILITY, COMPLETENESS, TIMELINESS, OR AVAILABILITY OF THE SERVICES.
          </p>
          <p className="text-sm leading-7 text-red-900 mb-3">
            <strong>5.2</strong> WITHOUT LIMITING THE FOREGOING, THE COMPANY DOES NOT WARRANT THAT: (i) THE SERVICES
            WILL MEET YOUR REQUIREMENTS OR EXPECTATIONS; (ii) THE SERVICES WILL OPERATE WITHOUT INTERRUPTION, BE
            ERROR-FREE, OR BE FREE OF BUGS, VIRUSES, OR OTHER HARMFUL COMPONENTS; (iii) ANY ERRORS OR DEFECTS IN THE
            SERVICES WILL BE CORRECTED; (iv) ANY INFORMATION OBTAINED BY YOU THROUGH THE SERVICES WILL BE ACCURATE,
            RELIABLE, OR COMPLETE; OR (v) ANY DATA TRANSMITTED THROUGH THE SERVICES WILL BE SECURE.
          </p>
          <p className="text-sm leading-7 text-red-900">
            <strong>5.3</strong> THE COMPANY MAKES NO WARRANTY, REPRESENTATION, OR GUARANTEE REGARDING THE
            RELIABILITY, UPTIME, AVAILABILITY, OR SECURITY OF ANY THIRD-PARTY SERVICES INTEGRATED WITH THE PLATFORM,
            INCLUDING WHATSAPP, STRIPE, OR ANY MESSAGING GATEWAY PROVIDER. ANY RELIANCE YOU PLACE ON SUCH
            THIRD-PARTY SERVICES IS ENTIRELY AT YOUR OWN RISK.
          </p>
        </section>

        {/* 6 – LIABILITY */}
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <h2 className="text-xl font-bold text-amber-900 mb-4">6. Limitation of Liability — We Are Not Liable</h2>
          <p className="text-sm leading-7 text-amber-900 mb-3 font-semibold uppercase tracking-wide">
            READ THIS SECTION CAREFULLY. IT SIGNIFICANTLY LIMITS YOUR LEGAL RIGHTS AGAINST THE COMPANY.
          </p>
          <p className="text-sm leading-7 text-amber-900 mb-3">
            <strong>6.1 Exclusion of Indirect Damages.</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW,
            IN NO EVENT SHALL THE COMPANY, ITS OFFICERS, DIRECTORS, SHAREHOLDERS, EMPLOYEES, AGENTS, AFFILIATES,
            LICENSORS, OR SERVICE PROVIDERS (COLLECTIVELY, THE &ldquo;<strong>COMPANY PARTIES</strong>&rdquo;) BE
            LIABLE TO YOU OR ANY THIRD PARTY FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY,
            PUNITIVE, OR AGGRAVATED DAMAGES OF ANY KIND, INCLUDING BUT NOT LIMITED TO: LOSS OF REVENUE, LOSS OF
            PROFITS, LOSS OF BUSINESS, LOSS OF GOODWILL, LOSS OF DATA, LOSS OF ANTICIPATED SAVINGS, LOSS OF USE,
            BUSINESS INTERRUPTION, REPUTATIONAL HARM, OR COST OF SUBSTITUTE SERVICES, REGARDLESS OF WHETHER SUCH
            DAMAGES ARE BASED IN CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY, STATUTE, OR ANY OTHER
            THEORY OF LAW, AND EVEN IF THE COMPANY HAS BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p className="text-sm leading-7 text-amber-900 mb-3">
            <strong>6.2 Cap on Liability.</strong> TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, THE AGGREGATE
            TOTAL LIABILITY OF THE COMPANY PARTIES FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THIS AGREEMENT OR
            THE SERVICES, WHETHER IN CONTRACT, TORT, STATUTE, OR OTHERWISE, SHALL NOT EXCEED THE LESSER OF:
            (i) THE TOTAL FEES ACTUALLY PAID BY YOU TO THE COMPANY IN THE THREE (3) CALENDAR MONTHS IMMEDIATELY
            PRECEDING THE EVENT GIVING RISE TO THE CLAIM; OR (ii) ONE HUNDRED POUNDS STERLING (£100.00).
          </p>
          <p className="text-sm leading-7 text-amber-900 mb-3">
            <strong>6.3 Essential Basis.</strong> YOU ACKNOWLEDGE AND AGREE THAT THE LIMITATIONS OF LIABILITY SET
            FORTH IN THIS SECTION 6 REFLECT A REASONABLE AND FAIR ALLOCATION OF RISK BETWEEN THE PARTIES, THAT THE
            COMPANY WOULD NOT HAVE ENTERED INTO THIS AGREEMENT WITHOUT SUCH LIMITATIONS, AND THAT SUCH LIMITATIONS
            SHALL APPLY NOTWITHSTANDING ANY FAILURE OF ESSENTIAL PURPOSE OF ANY LIMITED REMEDY.
          </p>
          <p className="text-sm leading-7 text-amber-900">
            <strong>6.4 Jurisdictional Limitations.</strong> SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR
            LIMITATION OF CERTAIN WARRANTIES OR LIABILITIES. IN SUCH JURISDICTIONS, THE FOREGOING LIMITATIONS SHALL
            APPLY TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW. NOTHING IN THIS AGREEMENT SHALL EXCLUDE OR
            LIMIT ANY LIABILITY THAT CANNOT BE LAWFULLY EXCLUDED OR LIMITED UNDER APPLICABLE LAW.
          </p>
        </section>

        {/* 7 – DATA & SECURITY */}
        <section className="bg-gray-800 text-white rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">7. Data Security, Data Breaches, and Theft — No Responsibility</h2>
          <p className="text-sm leading-7 text-gray-200 mb-3 font-semibold uppercase tracking-wide">
            CRITICAL NOTICE — PLEASE READ THIS SECTION IN ITS ENTIRETY.
          </p>
          <p className="text-sm leading-7 text-gray-200 mb-3">
            <strong>7.1 No Guarantee of Security.</strong> While the Company employs commercially reasonable
            administrative, technical, and physical safeguards designed to protect User Data from unauthorised access,
            disclosure, alteration, and destruction, THE COMPANY DOES NOT AND CANNOT GUARANTEE THE ABSOLUTE SECURITY
            OF ANY DATA TRANSMITTED TO, STORED ON, OR PROCESSED BY THE PLATFORM. No method of electronic transmission
            or storage is one hundred percent (100%) secure, and the Company makes no warranty, express or implied,
            that User Data will be free from unauthorised access, interception, corruption, destruction, or theft.
          </p>
          <p className="text-sm leading-7 text-gray-200 mb-3">
            <strong>7.2 No Liability for Data Theft or Unauthorised Access.</strong> THE COMPANY SHALL BEAR
            ABSOLUTELY NO LIABILITY, RESPONSIBILITY, OR OBLIGATION OF ANY KIND WHATSOEVER TO YOU, ANY END CUSTOMER,
            ANY THIRD PARTY, OR ANY REGULATORY AUTHORITY ARISING OUT OF OR IN CONNECTION WITH: (i) ANY ACTUAL OR
            ALLEGED THEFT, LOSS, CORRUPTION, OR DESTRUCTION OF USER DATA; (ii) ANY ACTUAL OR ALLEGED UNAUTHORISED
            ACCESS TO OR DISCLOSURE OF USER DATA BY ANY THIRD PARTY, INCLUDING STATE-SPONSORED ACTORS, CRIMINAL
            ORGANISATIONS, HACKERS, OR OTHER MALICIOUS PARTIES; (iii) ANY ACTUAL OR ALLEGED DATA BREACH AFFECTING
            THE PLATFORM OR ANY THIRD-PARTY SERVICE INTEGRATED WITH THE PLATFORM; OR (iv) ANY ACTUAL OR ALLEGED
            INTERCEPTION OF DATA IN TRANSIT. YOU EXPRESSLY ACKNOWLEDGE AND AGREE THAT THE TRANSMISSION AND STORAGE
            OF DATA OVER THE INTERNET CARRIES INHERENT RISKS, AND YOU ASSUME ALL SUCH RISKS.
          </p>
          <p className="text-sm leading-7 text-gray-200 mb-3">
            <strong>7.3 Third-Party Infrastructure.</strong> The Platform relies on third-party infrastructure
            providers for data storage, message delivery, and payment processing. THE COMPANY IS NOT RESPONSIBLE AND
            SHALL NOT BE HELD LIABLE FOR ANY SECURITY INCIDENTS, DATA BREACHES, OR DATA LOSS ATTRIBUTABLE TO SUCH
            THIRD-PARTY PROVIDERS, INCLUDING BUT NOT LIMITED TO NEON TECHNOLOGIES (DATABASE), UPSTASH (CACHING
            AND QUEUE), META PLATFORMS, INC. (WHATSAPP), AND STRIPE, INC. (PAYMENTS). You should independently
            review the security policies and data processing terms of each such third-party provider.
          </p>
          <p className="text-sm leading-7 text-gray-200">
            <strong>7.4 Tenant Responsibility for End Customer Data.</strong> As a Tenant, You are the data controller
            (within the meaning of the UK GDPR) in respect of the personal data of Your End Customers that You
            collect, process, or transmit through the Platform. You are solely responsible for ensuring that Your
            collection and processing of End Customer data complies with all applicable data protection laws, including
            obtaining all necessary consents, maintaining appropriate records of processing activities, and responding
            to data subject requests. The Company acts solely as a data processor on Your behalf, pursuant to the
            data processing terms incorporated into this Agreement.
          </p>
        </section>

        {/* 8 – NO SUE */}
        <section className="bg-slate-900 text-white rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">8. Dispute Resolution, Waiver of Class Actions, and Limitation of Claims</h2>
          <p className="text-sm leading-7 text-slate-200 mb-3 font-semibold uppercase tracking-wide">
            IMPORTANT — THIS SECTION CONTAINS A BINDING ARBITRATION CLAUSE AND A CLASS ACTION WAIVER.
          </p>
          <p className="text-sm leading-7 text-slate-200 mb-3">
            <strong>8.1 Good-Faith Negotiation.</strong> Before initiating any formal legal proceedings, the parties
            agree to attempt to resolve any dispute, claim, or controversy arising out of or relating to this Agreement
            or the Services (&ldquo;<strong>Dispute</strong>&rdquo;) through good-faith negotiation. The party asserting
            the Dispute shall provide written notice to the other party describing the Dispute in reasonable detail.
            The parties shall have thirty (30) calendar days from the date of such notice to attempt to resolve the
            Dispute through negotiation (the &ldquo;<strong>Negotiation Period</strong>&rdquo;).
          </p>
          <p className="text-sm leading-7 text-slate-200 mb-3">
            <strong>8.2 Exclusive Jurisdiction.</strong> If a Dispute cannot be resolved during the Negotiation
            Period, the parties irrevocably submit to the exclusive jurisdiction of the courts of {GOVERNING_LAW}
            for the resolution of any Dispute. YOU HEREBY IRREVOCABLY WAIVE ANY RIGHT TO COMMENCE OR PARTICIPATE
            IN ANY LEGAL PROCEEDINGS IN ANY OTHER JURISDICTION, WHETHER FOR CONVENIENCE, FORUM SHOPPING, OR ANY
            OTHER REASON. For the avoidance of doubt, You agree that You shall not bring any claim against the
            Company in any jurisdiction other than {GOVERNING_LAW}, and You expressly waive any argument that
            any other jurisdiction is more convenient or appropriate.
          </p>
          <p className="text-sm leading-7 text-slate-200 mb-3">
            <strong>8.3 Waiver of Class Actions.</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ALL
            CLAIMS ARISING OUT OF OR RELATING TO THIS AGREEMENT OR THE SERVICES MUST BE BROUGHT IN YOUR INDIVIDUAL
            CAPACITY AND NOT AS A PLAINTIFF OR CLASS MEMBER IN ANY PURPORTED CLASS ACTION, COLLECTIVE ACTION,
            REPRESENTATIVE ACTION, PRIVATE ATTORNEY GENERAL ACTION, OR SIMILAR PROCEEDING. YOU HEREBY IRREVOCABLY
            WAIVE ANY RIGHT TO PARTICIPATE IN ANY SUCH COLLECTIVE OR REPRESENTATIVE PROCEEDING.
          </p>
          <p className="text-sm leading-7 text-slate-200 mb-3">
            <strong>8.4 Limitation Period.</strong> NOTWITHSTANDING ANY STATUTE OF LIMITATIONS OR OTHER PROVISION
            TO THE CONTRARY, ANY CLAIM ARISING OUT OF OR RELATING TO THIS AGREEMENT OR THE SERVICES MUST BE
            COMMENCED WITHIN ONE (1) YEAR AFTER THE CAUSE OF ACTION ACCRUES; OTHERWISE, SUCH CLAIM IS PERMANENTLY
            BARRED AND WAIVED. YOU HEREBY IRREVOCABLY WAIVE ALL RIGHTS TO ASSERT ANY CLAIM THAT IS NOT BROUGHT
            WITHIN THIS ONE-YEAR LIMITATION PERIOD.
          </p>
          <p className="text-sm leading-7 text-slate-200">
            <strong>8.5 Future Claims.</strong> BY ACCEPTING THESE TERMS, YOU ACKNOWLEDGE AND AGREE THAT YOU ARE
            WAIVING YOUR RIGHT TO SUE THE COMPANY, ITS OFFICERS, DIRECTORS, EMPLOYEES, OR AFFILIATES IN ANY COURT
            OF LAW OR OTHER TRIBUNAL IN ANY JURISDICTION WORLDWIDE FOR ANY CLAIM, LOSS, OR DAMAGE ARISING FROM OR
            RELATED TO: (i) ANY DATA BREACH OR SECURITY INCIDENT; (ii) ANY LOSS OF BUSINESS DATA; (iii) ANY
            FAILURE OR UNAVAILABILITY OF THE SERVICES; (iv) ANY ACTION OR OMISSION OF A THIRD-PARTY SERVICE
            PROVIDER; OR (v) ANY OTHER MATTER EXCLUDED FROM THE COMPANY&rsquo;S LIABILITY UNDER THIS AGREEMENT.
            THIS WAIVER IS BINDING UPON YOU AND YOUR HEIRS, SUCCESSORS, ASSIGNS, LEGAL REPRESENTATIVES, AND
            ANYONE CLAIMING THROUGH OR UNDER YOU.
          </p>
        </section>

        {/* 9 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">9. Indemnification</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>9.1</strong> You agree to indemnify, defend, and hold harmless the Company and the Company Parties
            from and against any and all claims, demands, actions, suits, proceedings, losses, liabilities, damages,
            costs, and expenses (including reasonable legal fees and disbursements) arising out of or in connection with:
          </p>
          <ol className="list-[lower-alpha] pl-6 space-y-2 text-sm leading-7 text-gray-700">
            <li>Your access to or use of the Services in breach of this Agreement;</li>
            <li>Your Business Data, including any allegation that such data infringes or misappropriates the intellectual property, privacy, or other rights of any third party;</li>
            <li>Your failure to obtain valid marketing consents from End Customers in compliance with applicable law;</li>
            <li>Your violation of any applicable law, regulation, or third-party rights;</li>
            <li>Any claims by End Customers arising from Your use of the Services;</li>
            <li>Your negligence, willful misconduct, or fraud.</li>
          </ol>
          <p className="text-sm leading-7 text-gray-700 mt-3">
            <strong>9.2</strong> The Company reserves the right, at Your expense, to assume exclusive control and
            defence of any matter for which You are required to indemnify the Company, and You agree to cooperate
            fully with the Company in the assertion of any available defences.
          </p>
        </section>

        {/* 10 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">10. Intellectual Property Rights</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>10.1 Company Ownership.</strong> The Platform, including all software, technology, designs,
            trademarks, service marks, logos, text, graphics, user interfaces, and other content (collectively,
            &ldquo;<strong>Company IP</strong>&rdquo;), is the sole and exclusive property of the Company and its
            licensors. Nothing in this Agreement grants You any right, title, or interest in or to the Company IP,
            other than the limited licence expressly granted herein. All rights not expressly granted herein are
            reserved by the Company.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>10.2 Tenant Data Ownership.</strong> As between the parties, You retain ownership of Your
            Business Data. You hereby grant the Company a non-exclusive, worldwide, royalty-free licence to access,
            use, process, store, and transmit Your Business Data solely as necessary to provide the Services and
            to fulfil the Company&rsquo;s obligations under this Agreement.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>10.3 Feedback.</strong> If You provide the Company with any feedback, suggestions, ideas, or
            recommendations regarding the Platform (&ldquo;<strong>Feedback</strong>&rdquo;), You hereby assign to
            the Company all right, title, and interest in and to such Feedback, and the Company shall be free to
            use and exploit such Feedback without restriction and without compensation to You.
          </p>
        </section>

        {/* 11 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">11. Payment, Billing, and Refund Policy</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>11.1 Subscription Fees.</strong> Access to the Services requires payment of the applicable
            subscription fees (&ldquo;<strong>Fees</strong>&rdquo;) as set out on the Company&rsquo;s pricing page
            or as otherwise agreed in writing. All Fees are stated in Pounds Sterling (GBP) unless otherwise specified
            and are exclusive of any applicable value-added tax (&ldquo;VAT&rdquo;) or other taxes, which shall be
            Your sole responsibility.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>11.2 Billing and Renewal.</strong> Fees are billed in advance on a monthly or annual basis
            depending on the subscription plan selected. Subscriptions automatically renew at the end of each billing
            period unless cancelled at least twenty-four (24) hours before the renewal date. The Company reserves the
            right to change its pricing at any time with at least thirty (30) days&rsquo; prior notice to Tenants.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>11.3 Payment Processing.</strong> Payments are processed by Stripe, Inc., a third-party payment
            processor. By providing Your payment information, You authorise the Company to charge the applicable Fees
            to Your designated payment method. THE COMPANY IS NOT RESPONSIBLE FOR ANY ERRORS, FAILURES, FRAUD, OR
            UNAUTHORISED CHARGES BY STRIPE, INC. OR ANY OTHER PAYMENT PROCESSOR.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>11.4 No Refunds.</strong> EXCEPT AS REQUIRED BY APPLICABLE LAW OR AS EXPRESSLY STATED IN THE
            COMPANY&rsquo;S REFUND POLICY, ALL FEES ARE NON-REFUNDABLE. CANCELLATION OF YOUR ACCOUNT DOES NOT
            ENTITLE YOU TO A REFUND OF ANY PREPAID FEES FOR THE REMAINDER OF YOUR CURRENT BILLING PERIOD.
          </p>
        </section>

        {/* 12 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">12. Suspension and Termination</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>12.1 Termination by Tenant.</strong> You may cancel Your Account at any time through the
            Account settings within the Platform. Termination will take effect at the end of Your current billing
            period, unless the Company agrees otherwise in writing.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>12.2 Termination or Suspension by Company.</strong> The Company reserves the right, in its sole
            and absolute discretion and without notice or liability to You, to suspend, restrict, or permanently
            terminate Your Account and access to the Services at any time for any reason, including but not limited to:
            breach of this Agreement; failure to pay applicable Fees; conduct that the Company reasonably believes
            poses a risk to the Company, its users, or third parties; or violation of applicable law.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>12.3 Effect of Termination.</strong> Upon termination of Your Account for any reason: all licences
            granted to You under this Agreement shall immediately terminate; You shall immediately cease all use of the
            Services; and the Company may, in its sole discretion, permanently delete Your Business Data within
            thirty (30) days of termination. The Company shall have no obligation to retain or export any Business
            Data following termination. Sections 4.2, 5, 6, 7, 8, 9, 10, 12.3, 13, and 14 of this Agreement
            shall survive any termination or expiration of this Agreement.
          </p>
        </section>

        {/* 13 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">13. WhatsApp Messaging — Special Provisions</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>13.1 Compliance with WhatsApp Policies.</strong> Use of the WhatsApp messaging features within
            the Platform is subject to WhatsApp&rsquo;s Business Policy and Terms of Service, as amended from time
            to time by Meta Platforms, Inc. You are solely responsible for ensuring that all messages sent through
            the Platform comply with WhatsApp&rsquo;s applicable policies, including restrictions on promotional
            messaging, opt-in requirements, and prohibited content categories.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>13.2 Consent and Opt-Out.</strong> You acknowledge that applicable law and WhatsApp policy require
            valid affirmative consent from each End Customer prior to sending marketing communications. You are solely
            and exclusively responsible for obtaining, documenting, and maintaining such consents. The Company shall
            bear no liability whatsoever for any claim, fine, or penalty arising from Your failure to obtain or
            maintain required consents.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>13.3 Account Bans.</strong> THE COMPANY MAKES NO GUARANTEE THAT YOUR WHATSAPP ACCOUNT OR SESSION
            WILL NOT BE BANNED, RESTRICTED, OR SUSPENDED BY META PLATFORMS, INC. ANY SUCH BAN OR RESTRICTION IS
            ENTIRELY BEYOND THE COMPANY&rsquo;S CONTROL, AND THE COMPANY SHALL BEAR NO LIABILITY WHATSOEVER FOR
            ANY LOSS OR DAMAGE ARISING FROM ANY SUCH BAN OR RESTRICTION.
          </p>
        </section>

        {/* 14 */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-4">14. General Provisions</h2>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>14.1 Governing Law.</strong> This Agreement and any Dispute arising out of or in connection with
            it shall be governed by and construed in accordance with the laws of {GOVERNING_LAW}, without regard to
            its conflict of law provisions.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>14.2 Severability.</strong> If any provision of this Agreement is held by a court of competent
            jurisdiction to be invalid, illegal, or unenforceable, such provision shall be severed from this Agreement
            and the remaining provisions shall continue in full force and effect. The parties agree to replace any
            invalid or unenforceable provision with a valid provision that, to the greatest extent possible, achieves
            the original commercial intent of the severed provision.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>14.3 Entire Agreement.</strong> This Agreement, together with the Privacy Policy and any
            applicable Order Form or Subscription Agreement, constitutes the entire agreement between the parties
            with respect to the subject matter hereof and supersedes all prior and contemporaneous agreements,
            representations, and warranties.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>14.4 No Waiver.</strong> The failure of either party to enforce any right or provision of this
            Agreement shall not constitute a waiver of such right or provision. Any waiver of any provision of this
            Agreement must be in writing and signed by the waiving party to be effective.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>14.5 Assignment.</strong> You may not assign or transfer any of Your rights or obligations under
            this Agreement without the Company&rsquo;s prior written consent. The Company may freely assign or
            transfer this Agreement, including in connection with a merger, acquisition, reorganisation, or sale of
            all or substantially all of its assets, without Your consent.
          </p>
          <p className="text-sm leading-7 text-gray-700 mb-3">
            <strong>14.6 Force Majeure.</strong> The Company shall not be liable for any delay or failure to perform
            its obligations under this Agreement to the extent such delay or failure is caused by circumstances beyond
            the Company&rsquo;s reasonable control, including but not limited to: acts of God, pandemics, natural
            disasters, war, terrorism, government orders, internet or telecommunications failures, third-party
            infrastructure outages, or actions of Meta Platforms, Inc. or other third-party providers.
          </p>
          <p className="text-sm leading-7 text-gray-700">
            <strong>14.7 Contact.</strong> Any notices required or permitted under this Agreement shall be in writing
            and sent to: <strong>{COMPANY_EMAIL}</strong>.
          </p>
        </section>

        {/* Signature block */}
        <div className="bg-gray-100 border border-gray-200 rounded-xl p-6 text-sm text-gray-600 leading-7">
          <p className="font-semibold text-gray-800 mb-2">Acknowledgement</p>
          <p>
            BY ACCESSING OR USING THE PLATFORM, YOU ACKNOWLEDGE THAT YOU HAVE READ THESE TERMS AND CONDITIONS IN
            THEIR ENTIRETY, UNDERSTAND THEM, AND AGREE TO BE LEGALLY BOUND BY THEM. IF YOU ARE ACCEPTING THESE TERMS
            ON BEHALF OF A LEGAL ENTITY, YOU REPRESENT AND WARRANT THAT YOU HAVE THE AUTHORITY TO BIND THAT ENTITY
            TO THESE TERMS.
          </p>
          <p className="mt-4">
            <strong>{COMPANY_NAME}</strong><br />
            Effective Date: {EFFECTIVE_DATE}<br />
            Version: 1.0
          </p>
        </div>

        {/* Footer nav */}
        <div className="text-center text-xs text-gray-400 pb-10">
          &copy; {new Date().getFullYear()} {COMPANY_NAME} — All rights reserved. &nbsp;|&nbsp;{' '}
          <a href="mailto:{COMPANY_EMAIL}" className="underline hover:text-gray-600">{COMPANY_EMAIL}</a>
        </div>
      </div>
    </div>
  );
}
