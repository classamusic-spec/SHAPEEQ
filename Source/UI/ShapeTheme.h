#pragma once

#include <juce_graphics/juce_graphics.h>

/*
    ShapeTheme — the single source of truth for SHAPE's visual language.

    Every colour, metric and type role used anywhere in the interface is
    declared here. No component may construct a literal Colour, a literal
    corner radius or a literal font size of its own; if something is
    missing from this file, add it here first.

    The values mirror design/prototype/shape-ui.html one for one. That
    prototype is the executable specification for this header — when one
    changes, change the other in the same commit.

    Design direction: a brushed-aluminium faceplate with a near-black
    display well milled into it. The chassis is light and physical; the
    graph is dark and luminous. That contrast is the product's signature
    and every token below serves it.
*/

namespace shape::theme
{
    // =====================================================================
    // Colour — semantic roles, never raw hues at the call site
    // =====================================================================
    namespace colour
    {
        // --- the faceplate: brushed aluminium, lit from above ---
        inline const juce::Colour chassisHi   { 0xfff2f4f6 };  // top of the body gradient
        inline const juce::Colour chassis     { 0xffd4d8dd };  // mid
        inline const juce::Colour chassisLo   { 0xffaeb4bb };  // bottom
        inline const juce::Colour chassisEdge { 0xff8a9098 };  // outer rim

        // Raised panels sitting on the faceplate (the band strip).
        inline const juce::Colour panelHi     { 0xffe2e5e9 };
        inline const juce::Colour panel       { 0xffd0d5da };
        inline const juce::Colour panelLo     { 0xffbcc2c9 };

        // --- the display well: near-black, set behind a milled bezel ---
        inline const juce::Colour wellBg      { 0xff0c0e12 };  // bottom of the well gradient
        inline const juce::Colour wellBgTop   { 0xff171b21 };  // top
        inline const juce::Colour wellLine    { 0xff262b33 };  // the well's inner hairline
        inline const juce::Colour nodeCore    { 0xff12151a };  // fill inside an EQ node ring

        // --- ink ---
        inline const juce::Colour ink         { 0xff262b33 };  // on the faceplate
        inline const juce::Colour inkSecond   { 0xff5b636d };
        inline const juce::Colour inkMuted    { 0xff878f99 };
        inline const juce::Colour onDark      { 0xffc8cfd8 };  // on the display
        inline const juce::Colour onDarkMuted { 0xff98a1ac };  // inactive display controls

        // --- signal semantics ---
        // These carry meaning and are never decorative. Amber marks the
        // active control and the selected band, and nothing else: that is
        // what keeps one node readable against a full spectrum.
        inline const juce::Colour amber       { 0xffff9e2c };  // active / selected
        inline const juce::Colour cyan        { 0xff45c2f0 };  // frequency, Q, I/O
        inline const juce::Colour violet      { 0xff9b7bf0 };  // dynamics
        inline const juce::Colour green       { 0xff6fc98a };
        inline const juce::Colour orange      { 0xffffa53d };
        inline const juce::Colour clip        { 0xffde6b4a };

        // The curve takes its hue from whichever band is local to that
        // frequency, so it shifts colour along its length. This is the
        // cycle, ordered so neighbouring bands never share a hue.
        inline const juce::Colour bandCycle[] { cyan, violet, orange, cyan, green, violet };

        // --- display washes (alpha is part of the token) ---
        inline const juce::Colour gridMajor     { juce::Colours::white.withAlpha (0.10f) };
        inline const juce::Colour gridMinor     { juce::Colours::white.withAlpha (0.045f) };
        inline const juce::Colour gridZero      { juce::Colours::white.withAlpha (0.16f) };
        inline const juce::Colour spectrumFill  { juce::Colour (0xffc8d2de).withAlpha (0.16f) };
        inline const juce::Colour spectrumLine  { juce::Colour (0xffd2dae4).withAlpha (0.45f) };
        inline const juce::Colour spectrumPeak  { juce::Colours::white.withAlpha (0.14f) };
        inline const juce::Colour spectrumPost  { violet.withAlpha (0.80f) };
        inline const juce::Colour dynamicRegion { violet.withAlpha (0.13f) };

        // Curve rendering: a wide faint pass, a narrower brighter pass,
        // then the core stroke. Cheaper and cleaner than a shadow blur.
        inline constexpr float curveFillAlpha  = 0.20f;
        inline constexpr float curveGlowOuter  = 0.18f;
        inline constexpr float curveGlowInner  = 0.30f;
    }

    // =====================================================================
    // Metrics
    // =====================================================================
    namespace metrics
    {
        inline constexpr float spacingXS  =  4.0f;
        inline constexpr float spacingS   =  8.0f;
        inline constexpr float spacingM   = 12.0f;
        inline constexpr float spacingL   = 16.0f;
        inline constexpr float spacingXL  = 24.0f;
        inline constexpr float spacingXXL = 32.0f;

        inline constexpr float chassisRadius = 14.0f;
        inline constexpr float wellRadius    = 10.0f;
        inline constexpr float bezelWidth    =  3.0f;
        inline constexpr float panelRadius   = 10.0f;
        inline constexpr float controlRadius =  7.0f;
        inline constexpr float pillRadius    = 999.0f;
        inline constexpr float hairline      =  1.0f;

        // --- the knob: a machined aluminium cylinder with an LED value arc ---
        inline constexpr float knobBody       = 52.0f;
        inline constexpr float knobBodyLarge  = 72.0f;
        inline constexpr float knobArcRadius  = 27.0f;
        inline constexpr float knobArcStroke  =  2.5f;
        inline constexpr float knobTickRadius = 30.0f;
        inline constexpr int   knobTickCount  = 11;
        inline constexpr float knobIndicator  = 13.0f;   // length
        inline constexpr float knobArcStart   = 135.0f;  // degrees
        inline constexpr float knobArcEnd     = 405.0f;
        inline constexpr float knobDragTravel = 190.0f;  // px for full range
        inline constexpr float knobFineScale  = 0.22f;   // shift-drag multiplier

        // --- EQ node ---
        inline constexpr float nodeRadius    =  7.0f;
        inline constexpr float nodeRing      =  2.5f;
        inline constexpr float nodeGlow      = 16.0f;
        inline constexpr float nodeSelectRing = 12.0f;
        inline constexpr float nodeHoverRing = 11.0f;
        inline constexpr float nodeHitRadius = 18.0f;

        // --- display padding, logical px. Top clears the floating toolbar;
        //     left and right leave room for the two rulers. ---
        inline constexpr float wellPadLeft   = 46.0f;
        inline constexpr float wellPadRight  = 46.0f;
        inline constexpr float wellPadTop    = 52.0f;
        inline constexpr float wellPadBottom = 26.0f;

        inline constexpr float curveStroke = 2.25f;

        inline constexpr int editorDefaultWidth  = 1400;
        inline constexpr int editorDefaultHeight = 940;
        inline constexpr int editorMinWidth      = 860;
        inline constexpr int editorMinHeight     = 660;
    }

    // =====================================================================
    // Typography
    // =====================================================================
    namespace type
    {
        inline constexpr const char* family = "Inter";

        inline constexpr float wordmark   = 34.0f;   // weight 200
        inline constexpr float descriptor =  9.5f;
        inline constexpr float presetName = 17.0f;
        inline constexpr float presetTag   = 8.5f;
        inline constexpr float label      =  9.5f;   // tracked uppercase
        inline constexpr float caption    = 10.0f;
        inline constexpr float body       = 12.0f;
        inline constexpr float readout    = 13.5f;
        inline constexpr float axis       = 10.0f;

        // Tracking, as a fraction of point size.
        inline constexpr float trackWordmark   = 0.42f;
        inline constexpr float trackDescriptor = 0.28f;
        inline constexpr float trackTag        = 0.22f;
        inline constexpr float trackCaption    = 0.18f;
        inline constexpr float trackLabel      = 0.14f;
        inline constexpr float trackButton     = 0.12f;
        inline constexpr float trackTagline    = 0.30f;

        // Readouts are tabular so digits hold their column while a value
        // is being dragged.
        juce::Font ui   (float height, int weight = 400, bool tabular = false);
    }

    // =====================================================================
    // Motion
    // =====================================================================
    namespace motion
    {
        inline constexpr int fastMs    = 120;   // hover / press
        inline constexpr int glowMs    = 140;   // amber ring fade
        inline constexpr int targetFps =  60;

        // Analyser display ballistics, per-frame coefficients at 60 fps.
        inline constexpr float analyzerAttack  = 0.52f;
        inline constexpr float analyzerRelease = 0.045f;
        inline constexpr float peakDecayDbPerSec = 26.0f;
    }

    // =====================================================================
    // Canvas scales
    // =====================================================================
    namespace scale
    {
        inline constexpr double freqMin = 10.0;
        inline constexpr double freqMax = 30000.0;

        // Left ruler: EQ gain, fixed at +/-24 dB.
        inline constexpr double gainRange = 24.0;

        // Right ruler: a finer gain ruler on the same pixel rows, whose
        // range the SCALE control picks. It is NOT a level meter — the
        // ticks are derived from the setting so they never print numbers
        // that disagree with the gridlines they sit on.
        inline constexpr int fineScaleOptions[] = { 12, 6 };
        inline constexpr int fineScaleDefault   = 12;

        // Analyser magnitudes get their own mapping across the well.
        inline constexpr double analyzerTopDb    =  26.0;
        inline constexpr double analyzerBottomDb = -74.0;

        inline constexpr int maxBands = 24;
    }
}
