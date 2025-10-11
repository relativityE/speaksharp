import { Button } from "@/components/ui/button";
import { Mic, BarChart3, Home, LogOut } from "lucide-react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/useAuth";

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, supabase } = useAuth();

  const handleSignOut = async () => {
    await supabase?.auth.signOut();
    navigate("/", { replace: true });
  };

  const navItems = [
    { path: "/", icon: Home, label: "Home" },
    { path: "/session", icon: Mic, label: "Session" },
    { path: "/analytics", icon: BarChart3, label: "Analytics" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border shadow-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-hero rounded-lg flex items-center justify-center">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-foreground">SpeakSharp</span>
          </Link>

          {/* Navigation Items */}
          {session && (
            <div className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Button
                    key={item.path}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    asChild
                  >
                    <Link to={item.path} className="flex items-center space-x-2">
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </Link>
                  </Button>
                );
              })}
            </div>
          )}

          {/* User Actions */}
          <div className="flex items-center space-x-3">
            {session ? (
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/auth">Sign In</Link>
                </Button>
                <Button variant="hero" size="sm" asChild>
                  <Link to="/auth">Get Started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {session && (
      <div className="md:hidden flex justify-center space-x-1 px-4 pb-3">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Button
              key={item.path}
              variant={isActive ? "default" : "ghost"}
              size="sm"
              asChild
            >
              <Link to={item.path} className="flex items-center space-x-1">
                <item.icon className="h-4 w-4" />
                <span className="text-xs">{item.label}</span>
              </Link>
            </Button>
          );
        })}
      </div>
    </nav>
  );
};

export default Navigation;