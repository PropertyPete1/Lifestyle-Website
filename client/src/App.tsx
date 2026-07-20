import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import GetStarted from "./pages/GetStarted";
import Search, { Portfolio } from "./pages/Search";
import ListingDetail from "./pages/ListingDetail";
import Neighborhoods from "./pages/Neighborhoods";
import NeighborhoodDetail from "./pages/NeighborhoodDetail";
import CityFinder from "./pages/CityFinder";
import Team from "./pages/Team";
import Testimonials from "./pages/Testimonials";
import Valuation from "./pages/Valuation";
import Contact from "./pages/Contact";
import Sell from "./pages/Sell";
import Join from "./pages/Join";
import Links from "./pages/Links";
import Privacy from "./pages/Privacy";
import Admin from "./pages/Admin";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/get-started"} component={GetStarted} />
      <Route path={"/search"} component={Search} />
      <Route path={"/portfolio"} component={Portfolio} />
      <Route path={"/listing/:slug"} component={ListingDetail} />
      <Route path={"/neighborhoods"} component={Neighborhoods} />
      <Route path={"/city-finder"} component={CityFinder} />
      <Route path={"/team"} component={Team} />
      <Route path={"/testimonials"} component={Testimonials} />
      <Route path={"/valuation"} component={Valuation} />
      <Route path={"/contact"} component={Contact} />
      <Route path={"/sell"} component={Sell} />
      <Route path={"/join"} component={Join} />
      <Route path={"/links"} component={Links} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/admin"} component={Admin} />
      <Route path={"/admin/:tab"} component={Admin} />
      <Route path={"/404"} component={NotFound} />
      {/* City & neighborhood landing pages resolved by slug (must be last before fallback) */}
      <Route path={"/:slug"} component={NeighborhoodDetail} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
