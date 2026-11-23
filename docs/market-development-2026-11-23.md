# TirekCRM market research and development decisions

Reviewed 23 November 2026. Target hypothesis carried forward from the existing roadmap — small installation and repair teams in Kazakhstan. This review uses public supplier documentation and the local repository. Customer demand, competitor usability, local payment availability and willingness to pay still need pilot evidence.

## What the comparison establishes

| Product | Documented capability | Implication for TirekCRM |
| --- | --- | --- |
| Jobber | Client hub combines work requests, quote approval, appointment details and payments. | A client-facing link is an expected capability. Connect our approved quotes and published work history with a request for another visit. [Client hub](https://www.getjobber.com/features/client-hub/) |
| Orderry | Closed work order profit includes parts, work, employee salaries and taxes. Estimated profit while adding items has a narrower calculation. | Label the inputs to every profit figure. Our labour, approved expenses and issued material costs should reconcile with the order and export. Tax accounting needs its own defined requirements. [Profit report](https://help.orderry.com/en/articles/9134577-work-orders-profit-report), [estimated profit](https://help.orderry.com/en/articles/9133897-how-to-add-services-and-products-to-work-orders) |
| Planado | Required report fields prevent job closure. Its mobile app supports offline checklists and photos. | Add mandatory acceptance checks consistently to the website and Telegram completion paths. Measure field connectivity before choosing the scope of offline synchronisation. [Field app](https://planado.app/features/field-service-app) |
| Housecall Pro | Job templates, checklists, job costing, labour rates, time tracking and materials appear within its operational workflow. | Make the existing order card the entry point for cost and quality decisions. Test how quickly a new owner can complete that workflow. [Settings overview](https://help.housecallpro.com/en/articles/7919484-settings-page-overview) |
| Bitrix24 Kazakhstan | CRM integrates tasks, deadlines, calendars, communications and automation. | Focus our initial sales demonstration on a specific repair or installation workflow with a measured outcome. [Tasks and projects](https://www.bitrix24.kz/features/tasks.php) |

The proposed advantage is a testable hypothesis. Before completing an order, the owner can explain expected profit using confirmed hours, remaining work, material issues, receipts and the cost of a repeat visit. Telegram is one convenient employee entry point. Profit and repeat-visit cost should remain traceable in the CRM.

## Repository findings and delivery order

Existing code supports quotes and additional work, Telegram assignments and photos, approved time, order profitability forecasts, receipt review, stock issues and returns, and a published QR passport. These provide the foundation for the demonstration.

| Priority | Deliverable | Acceptance |
| --- | --- | --- |
| Current increment | Browser password recovery and a usable email link | Login opens recovery. Unknown email receives the same response as a known one. A valid single-use link changes the password and revokes old sessions. Invalid, expired, unavailable and network error states have a visible next action. |
| Next | Acceptance and repeat visits | Owner defines required checks. Both completion entry points enforce them. A repeat visit links to its original order, records the reason, and its approved hours and materials affect the original financial result exactly once. Existing completed orders remain readable. |
| After acceptance | Orders requiring an owner decision | A filtered list exposes forecast loss, missing rates, pending receipts and overdue approvals. Each item opens its underlying evidence. Unknown costs remain visibly incomplete. |
| After pilot feedback | Object history and repeat request | A revoked public link stops access. A customer sees published information and can request another visit. Retries produce one request. |
| Before external pilot | Reliable hosted operation and onboarding | Agreed HTTPS hosting, invitation and recovery delivery, restore rehearsal, isolated regression environment and dependency checks. A new owner can create a company, invite an employee and complete a first order. |

Deployment depends on the running environment. Current public-origin settings must match the address reachable by the recipient. Hosting and service costs belong in the pilot budget.

## How to validate the advantage

Interview eight owners or dispatchers from the target segment before choosing a wider feature set. Ask them to walk through a recent loss-making order, a repeat visit, purchase handling and their present tools. Record time spent, missing evidence and the decision that was delayed. Obtain permission before collecting their business data.

Proposed pilot — two teams and 20 completed orders. Establish each team's baseline on comparable work before using TirekCRM. Record time to first completed order, minutes spent reconciling costs, missing cost inputs, repeat-visit costs, delivery failures and weekly active owners. Proposed acceptance targets are zero unexplained financial discrepancies and at least 30% less reconciliation time. These are targets to validate.

At each weekly review, examine unsuccessful workflows as well as completed orders. Prioritise a change when several owners describe the same costly problem and can demonstrate it on a real order. Test willingness to pay using a concrete offer after the pilot. Pricing requires customer and operating-cost evidence.

## Decisions that need further evidence

Offline support depends on observed connectivity and conflict handling requirements. OCR requires receipt recognition accuracy and a human approval workflow. Local acquiring and accounting integrations require provider support, transaction costs and customer demand. Legal and accounting requirements for actual hosting, staff and client documents require a scoped Kazakhstan review before launch. Public feature descriptions alone cannot establish market leadership or commercial readiness.
