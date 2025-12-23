import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export function DesignSystemPage() {
    return (
        <div className="container mx-auto p-8 space-y-12">
            <div className="space-y-4">
                <h1 className="text-4xl font-bold tracking-tight">Design System Showcase</h1>
                <p className="text-muted-foreground text-lg">
                    A visual reference for the application's design tokens and components.
                </p>
            </div>

            <hr className="my-8 opacity-20" />

            {/* Typography Section */}
            <section className="space-y-6">
                <h2 className="text-2xl font-semibold">Typography</h2>
                <Card>
                    <CardContent className="space-y-4 pt-6">
                        <div>
                            <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl">Heading 1</h1>
                            <span className="text-xs text-muted-foreground">text-4xl font-extrabold tracking-tight lg:text-5xl</span>
                        </div>
                        <div>
                            <h2 className="text-3xl font-semibold tracking-tight first:mt-0">Heading 2</h2>
                            <span className="text-xs text-muted-foreground">text-3xl font-semibold tracking-tight</span>
                        </div>
                        <div>
                            <h3 className="text-2xl font-semibold tracking-tight">Heading 3</h3>
                            <span className="text-xs text-muted-foreground">text-2xl font-semibold tracking-tight</span>
                        </div>
                        <div>
                            <h4 className="text-xl font-semibold tracking-tight">Heading 4</h4>
                            <span className="text-xs text-muted-foreground">text-xl font-semibold tracking-tight</span>
                        </div>
                        <div>
                            <p className="leading-7 [&:not(:first-child)]:mt-6">
                                The quick brown fox jumps over the lazy dog. This is a standard paragraph styled with proper leading and spacing.
                            </p>
                            <span className="text-xs text-muted-foreground">leading-7</span>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">Muted text for secondary information.</p>
                            <span className="text-xs text-muted-foreground">text-sm text-muted-foreground</span>
                        </div>
                    </CardContent>
                </Card>
            </section>

            {/* Buttons Section */}
            <section className="space-y-6">
                <h2 className="text-2xl font-semibold">Buttons</h2>
                <Card>
                    <CardHeader>
                        <CardTitle>Variants & Sizes</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-6">
                        <div className="flex flex-wrap gap-4 items-center">
                            <Button>Primary</Button>
                            <Button variant="secondary">Secondary</Button>
                            <Button variant="destructive">Destructive</Button>
                            <Button variant="outline">Outline</Button>
                            <Button variant="ghost">Ghost</Button>
                            <Button variant="link">Link</Button>
                        </div>
                        <div className="flex flex-wrap gap-4 items-center">
                            <Button size="sm">Small</Button>
                            <Button size="default">Default</Button>
                            <Button size="lg">Large</Button>
                            <Button size="icon" aria-label="Icon"><span className="h-4 w-4">★</span></Button>
                        </div>
                        <div className="flex flex-wrap gap-4 items-center">
                            <Button disabled>Disabled</Button>
                            <Button variant="outline" className="loading">Loading (Custom)</Button>
                        </div>
                    </CardContent>
                </Card>
            </section>

            {/* Inputs Section */}
            <section className="space-y-6">
                <h2 className="text-2xl font-semibold">Inputs</h2>
                <div className="grid md:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Text Fields</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid w-full max-w-sm items-center gap-1.5">
                                <Input type="email" placeholder="Email" />
                            </div>
                            <div className="grid w-full max-w-sm items-center gap-1.5">
                                <Input type="password" placeholder="Password" />
                            </div>
                            <div className="grid w-full max-w-sm items-center gap-1.5">
                                <Input disabled type="text" placeholder="Disabled Input" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </section>

            {/* Badges Section */}
            <section className="space-y-6">
                <h2 className="text-2xl font-semibold">Badges</h2>
                <Card>
                    <CardContent className="pt-6 flex gap-4">
                        <Badge variant="primary">Primary</Badge>
                        <Badge variant="secondary">Secondary</Badge>
                        <Badge variant="destructive">Destructive</Badge>
                        <Badge variant="outline">Outline</Badge>
                    </CardContent>
                </Card>
            </section>

            {/* Cards Section */}
            <section className="space-y-6">
                <h2 className="text-2xl font-semibold">Cards</h2>
                <div className="grid md:grid-cols-3 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Card Title</CardTitle>
                            <CardDescription>Card Description</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p>Card Content goes here.</p>
                        </CardContent>
                        <CardFooter>
                            <p className="text-sm text-muted-foreground">Footer</p>
                        </CardFooter>
                    </Card>
                    <Card className="shadow-elegant">
                        <CardHeader><CardTitle>Elegant Shadow</CardTitle></CardHeader>
                        <CardContent>Uses custom `shadow-elegant` token.</CardContent>
                    </Card>
                </div>
            </section>

            {/* Skeleton Section */}
            <section className="space-y-6">
                <h2 className="text-2xl font-semibold">Loading States</h2>
                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <div className="flex items-center space-x-4">
                            <Skeleton className="h-12 w-12 rounded-full" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-[250px]" />
                                <Skeleton className="h-4 w-[200px]" />
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </section>
        </div>
    );
}

export default DesignSystemPage;

