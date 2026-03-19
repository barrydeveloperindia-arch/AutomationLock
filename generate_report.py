import os
from fpdf import FPDF

def sanitize(text):
    return text.replace('\u2014', '--').replace('\u2013', '-').replace('\u2018', "'").replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')

class ReportPDF(FPDF):
    def header(self):
        self.set_font('Arial', 'B', 15)
        self.cell(0, 10, 'AuraAccess: 7-Day Sprint Execution Report', 0, 1, 'C')
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font('Arial', 'I', 8)
        self.cell(0, 10, f'Page {self.page_no()}', 0, 0, 'C')

    def chapter_title(self, title):
        self.set_font('Arial', 'B', 12)
        self.set_fill_color(200, 220, 255)
        self.ln(5)
        self.cell(0, 10, sanitize(title), 0, 1, 'L', 1)
        self.ln(4)

    def chapter_body(self, text):
        self.set_font('Arial', '', 10)
        # Using multi_cell to handle line breaks automatically
        for line in text.split('\n'):
            line = sanitize(line.strip())
            if line:
                if line.startswith('*'):
                    self.set_x(15)
                    self.multi_cell(0, 6, line)
                    self.set_x(10)
                else:
                    self.multi_cell(0, 6, line)
        self.ln()

pdf = ReportPDF()
pdf.add_page()

# Section 1: API Sourcing Review
title1 = "Day 1: API Sourcing & Competitor Pricing Analysis"
body1 = """Based on exhaustive research, we have compared the two leading white-label smart lock ecosystems: Tuya Smart and TTLock.
* Tuya Smart Lock API:
  - Capabilities: Supports Wi-Fi, Zigbee, and Bluetooth. Includes temporary passwords, video intercom integration, and duress alarms.
  - Pricing: Tuya's IoT Core model restricts API calls heavily unless you pay massive enterprise fees. The Standard Edition is $5,000/year, making it unviable for a bootstrapped 7-day SaaS MVP.
* TTLock API (Recommended Winner):
  - Capabilities: Extremely robust Bluetooth functionality, offline eKey generation, passage mode, and extensive user management.
  - Pricing: Free/open developer API. Hardware is incredibly affordable, with baseline smart locks starting at just $30-$40 per unit on B2B marketplaces.
  - Integration: Can be wrapped easily using universal API aggregators like Seam.co, streamlining development in No-Code tools like FlutterFlow."""
pdf.chapter_title(title1)
pdf.chapter_body(body1)

# Section 2: Landing Page
title2 = "Day 2: The 'Fake Door' Landing Page Architecture"
body2 = """Brand Name: AuraAccess
Target Niche: 24/7 Boutique Gyms and Independent Wellness Studios

* Headline: Automate Your 24/7 Gym Access. No IT Required.
* Subheadline: Replace expensive enterprise infrastructure with a smart, affordable, software-first solution that just works. Manage all your doors and members directly from your phone.
* Core Value Props:
  1. Zero Wiring Required: Swap out your basic deadbolt or strike lock in 10 minutes.
  2. Complete Control, Anywhere: Generate 24-hour guest passes, revoke access instantly, and check gym occupancy from the cloud.
  3. Fair SaaS Pricing: No $500/door installation fees. Just affordable hardware and a simple monthly subscription.
* Call To Action (Button): Book a 10-Min Live Demo Today -> Links to Calendly/Typeform."""
pdf.chapter_title(title2)
pdf.chapter_body(body2)

# Section 3: Software MVP Data Structure
title3 = "Day 3 & 4: Software MVP Data Model (No-Code)"
body3 = """To build the MVP in FlutterFlow/Bubble, we will use the following simplified architecture connecting via Seam to the TTLock hardware:
* Database Collections:
  - Users: { id, email, role (admin/member), tier_status }
  - Locks: { id, device_id (TTLock physical ID), name (e.g., 'Front Door'), battery_status, online_status }
  - AccessLogs: { id, user_id, lock_id, timestamp, access_method (bluetooth/pin) }
* Core API Endpoints to build in No-Code:
  - POST /api/unlock: Triggers TTLock to open (used by Member App).
  - POST /api/generate_pin: Tells TTLock SDK to issue a temporary 4-digit pin.
  - GET /api/logs: Webhook receiver to populate the Admin Dashboard."""
pdf.chapter_title(title3)
pdf.chapter_body(body3)

# Section 4: Sales Pitch
title4 = "Day 5 & 6: Sales Pitch & Cold Outreach Script"
body4 = """Target Profile: Gym Owner/Manager.
Objective: Secure a 30-day Free Trial of the beta software, leading to a paid SaaS conversion.

Script:
"Hi [Owner's Name], this is [Your Name] from AuraAccess. I see you're running a great 24/7 space. I frequently speak with gym owners who hate how clunky and expensive systems like Spintly or Brivo are just to manage front door access. 
I've built a radically simpler tool: it's a software dashboard that pairs with affordable, wireless smart locks. You can grant access, monitor battery, and delete users from your phone in seconds. 
I'm looking for 5 beta testers locally—I'll provide the lock and software for a 30-day free trial, zero strings attached. If it saves you time, it's just a simple monthly fee after that. Can I drop by for 10 minutes on Tuesday to show you exactly how it works on my phone?"""
pdf.chapter_title(title4)
pdf.chapter_body(body4)

output_path = r"c:\Users\pc\Documents\Antigravity\doorEntryControl\AccessControlPrototype\AuraAccess_Execution_Report.pdf"
pdf.output(output_path)
print(f"PDF successfully generated at {output_path}")
