import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, BarChart2, Settings } from 'lucide-react';

const navigation = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Analytics', href: '/analytics', icon: BarChart2 },
  { name: 'Settings', href: '/settings', icon: Settings }, // A placeholder page
];

export const Sidebar = () => {
  return (
    <aside className="fixed top-0 left-0 h-screen w-64 bg-card text-foreground border-r border-border flex flex-col z-10">
      <div className="p-6 border-b border-border flex items-center justify-center">
        <h1 className="text-3xl font-bold text-primary tracking-wider">
          DevFolio
        </h1>
      </div>
      <nav className="flex-grow p-4">
        <ul className="space-y-2">
          {navigation.map((item) => (
            <li key={item.name}>
              <NavLink
                to={item.href}
                end // Use 'end' for exact matching on the root route
                className={({ isActive }) =>
                  `flex items-center px-4 py-3 rounded-md text-base font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                  }`
                }
              >
                <item.icon className="mr-4 h-6 w-6" />
                {item.name}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="p-6 border-t border-border">
        <div className="flex items-center">
          <div className="relative flex items-center justify-center w-4 h-4">
            <div className="absolute w-full h-full rounded-full bg-primary/50 animate-ping"></div>
            <div className="relative w-3 h-3 rounded-full bg-primary"></div>
          </div>
          <span className="ml-3 text-sm text-muted-foreground">Available for work</span>
        </div>
      </div>
    </aside>
  );
};
