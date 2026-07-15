import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <Card className="w-full max-w-md p-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This route does not exist in StudyFlow. The home screen is the main experience.
        </p>
        <Link href="/" className={`${buttonVariants({ size: 'lg' })} mt-6 w-full`}>
          Return Home
        </Link>
      </Card>
    </div>
  );
}
