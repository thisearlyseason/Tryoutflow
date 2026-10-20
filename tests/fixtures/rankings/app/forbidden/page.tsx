import { ErrorState } from '../../../../../src/components/feedback/error-state';
export default function Forbidden() {
  return (
    <ErrorState
      title="Rankings access denied"
      description="Your current role or scope cannot view these rankings."
    />
  );
}
