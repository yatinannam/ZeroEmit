"use client";

import Link from "next/link";
import { useLocationPicker } from "./use-location-picker";
import { Icon } from "./icon-set";
import { BottomNav, TopBar } from "./app-shell";
import { LocationModal } from "./location-modal";
import { PageHeader } from "./page-header";

// Inside the full app shell so an installed PWA (no browser back button) still has a way out.
export function NotFoundScreen() {
  const { place, locationOpen, openLocation, closeLocation, chooseLocation } = useLocationPicker();
  return <div className="mobile-app">
    <TopBar onChooseLocation={openLocation}/>
    <main className="dashboard-content">
      <PageHeader eyebrow="Page not found" title="This page doesn't exist." intro="The link may be old or mistyped. Everything else is one tap away."/>
      <Link className="primary-button" href="/"><Icon name="home" size={18}/> Back to home</Link>
    </main>
    <BottomNav/>
    {locationOpen && <LocationModal current={place} onClose={closeLocation} onChoose={chooseLocation}/>}
  </div>;
}
