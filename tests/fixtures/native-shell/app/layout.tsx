import '../../../../src/app/globals.css';
import '../../../../src/app/product.css';
import '../../../../src/app/sports-workspace.css';
import '../../../../src/modules/talent/ui/talent.css';
import { FixtureBridge } from './fixture-bridge';
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <FixtureBridge />
        {children}
      </body>
    </html>
  );
}
