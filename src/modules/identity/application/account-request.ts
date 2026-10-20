import 'server-only';
// Both native Bearer sessions and same-origin web cookies are verified by this shared boundary.
export { billingRequestContext as accountRequestContext } from '@/modules/subscriptions/application/billing-request';
