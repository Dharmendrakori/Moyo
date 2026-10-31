import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/**
 * TECHNICIAN AUTHENTICATION SHELL
 *
 * A deliberately minimal surface for `/technician/login` and
 * `/technician/activate/<token>`: no portal navigation, because neither page
 * knows who the visitor is yet.
 */
export default function TechnicianAuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="border-b border-ink-200 bg-night-950 text-white">
        <div className="mx-auto flex max-w-md items-center gap-2 px-4 py-3 text-sm font-semibold">
          <Icon name="bolt" size={18} className="text-gold-400" />
          <span>Seric Tech Solutions</span>
          <span className="text-white/50">· Technician</span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        {children}
        <p className="mt-6 text-center text-xs text-ink-400">
          <Link href="/" className="hover:text-ink-600 hover:underline">
            Back to Seric Tech Solutions
          </Link>
        </p>
      </main>
    </div>
  );
}
