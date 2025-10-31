import { Button } from "@/components/ui/button";
import { Mic, BarChart3, Home, User } from "lucide-react";
import { useLocation, Link } from "react-router-dom";
import { useAuth } from "@/contexts/useAuth";

const Navigation = () => {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const navItems = [
    { path: "/", icon: Home, label: "Home" },
    { path: "/session", icon: Mic, label: "Session" },
    { path: "/analytics", icon: BarChart3, label: "Analytics" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center">
        <div className="mr-4 hidden md:flex">
          <Link to="/" className="mr-6 flex items-center space-x-2">
            <Mic className="h-6 w-6 text-primary" />
            <span className="hidden font-bold sm:inline-block">SpeakSharp</span>
          </Link>
          <nav className="flex items-center space-x-6 text-sm font-medium">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`transition-colors hover:text-primary ${
                    isActive ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {/* User Actions */}
        <div className="flex flex-1 items-center justify-end space-x-2">
          {user ? (
            <Button variant="ghost" size="sm" onClick={signOut} data-testid="nav-sign-out-button">
              <User className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/auth" data-testid="nav-login-button">
                  <User className="h-4 w-4 mr-2" />
                  Login
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/auth">
                  Sign Up
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navigation;
