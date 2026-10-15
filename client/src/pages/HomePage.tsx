import { Link } from 'react-router-dom';
import { Check as CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const FEATURES = ['项目管理', '智能日报', '自动周报', '进度跟踪'];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      {/* 导航栏 */}
      <nav className="fixed top-0 right-0 left-0 z-50 bg-background/70 shadow-sm backdrop-blur-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <span className="text-xl font-bold text-primary">DayCraft</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" render={<Link to="/login" />}>
                登录
              </Button>
              <Button render={<Link to="/signup" />}>
                免费注册
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* 主要内容 */}
      <div className="flex grow items-center justify-center px-4 pt-16 pb-6 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-col items-center lg:flex-row">
            <div className="w-full lg:w-1/2 lg:pr-12">
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                <span className="text-primary">DayCraft</span>
                <span className="mt-2 block">专业工作管理平台</span>
              </h1>
              <p className="mt-4 text-lg leading-relaxed text-muted-foreground sm:text-xl">
                集项目管理、日报撰写、进度跟踪于一体的现代化工作平台。
                通过结构化的工作分解和智能化的报告生成，让工作更有条理，汇报更加专业。
              </p>
              <div className="mt-6 flex flex-wrap gap-4">
                <Button size="lg" render={<Link to="/signup" />}>
                  立即开始
                </Button>
                <Button size="lg" variant="outline" render={<Link to="/login" />}>
                  登录账号
                </Button>
              </div>

              {/* 功能亮点 */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                {FEATURES.map((feature) => (
                  <div key={feature} className="flex items-start">
                    <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <CheckIcon className="size-4 text-primary" />
                    </div>
                    <p className="ml-2 text-sm text-muted-foreground">{feature}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* 效果预览 - 仅大屏幕显示 */}
            <div className="mt-8 hidden w-full lg:mt-0 lg:block lg:w-1/2">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary/40 to-primary/60 opacity-30 blur-lg" />
                <Card className="relative shadow-xl">
                  <CardContent className="p-6">
                    <div className="aspect-video overflow-hidden rounded-md bg-accent p-4">
                      <Skeleton className="mb-4 h-6 w-1/3" />
                      <Skeleton className="mb-2 h-4 w-2/3" />
                      <Skeleton className="mb-2 h-4 w-1/2" />
                      <Skeleton className="mb-6 h-4 w-3/4" />
                      <div className="mb-4 flex gap-2">
                        <Skeleton className="size-8 rounded-md" />
                        <Skeleton className="size-8 rounded-md" />
                        <Skeleton className="size-8 rounded-md" />
                      </div>
                      <Skeleton className="mb-4 h-24 rounded-md" />
                      <Skeleton className="h-24 rounded-md" />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 页脚 */}
      <footer className="bg-primary px-4 py-4 text-primary-foreground sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl text-center text-sm">
          © 2026 DayCraft - 专业工作管理平台
        </div>
      </footer>
    </main>
  );
}
