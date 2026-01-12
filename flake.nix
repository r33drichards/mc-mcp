{
  description = "Mineflayer MCP - Minecraft bot control via MCP with screenshot support";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        # Chromium/Puppeteer runtime dependencies
        chromiumDeps = with pkgs; [
          chromium
          # Core libs
          glib
          nss
          nspr
          dbus
          atk
          at-spi2-atk
          cups
          libdrm
          expat
          libxkbcommon
          # X11
          xorg.libX11
          xorg.libXcomposite
          xorg.libXdamage
          xorg.libXext
          xorg.libXfixes
          xorg.libXrandr
          xorg.libxcb
          # Graphics
          mesa
          # GTK
          gtk3
          pango
          cairo
          # Audio
          alsa-lib
          # Fonts
          fontconfig
          freetype
        ];

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = chromiumDeps ++ (with pkgs; [
            nodejs_22
            nodePackages.npm
            python3
            pkg-config
            gnumake
            gcc
          ]);

          shellHook = ''
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath chromiumDeps}:$LD_LIBRARY_PATH"
            export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
            export PUPPETEER_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            export FONTCONFIG_FILE="${pkgs.fontconfig.out}/etc/fonts/fonts.conf"

            echo "Mineflayer MCP development environment loaded"
            echo "   Node.js: $(node --version)"
            echo "   Chromium: ${pkgs.chromium}/bin/chromium"
          '';
        };

        packages.default = pkgs.buildNpmPackage {
          pname = "mineflayer-mcp";
          version = "1.0.0";
          src = ./.;

          nodejs = pkgs.nodejs_20;

          npmDepsHash = "sha256-fopjdnTwmGotBtXIrmX/BcK4CrvvNAIRmzAS+9XczSw=";

          nativeBuildInputs = with pkgs; [
            pkg-config
            python3
            gnumake
            makeWrapper
          ];

          buildInputs = chromiumDeps;

          # Skip Chromium download - we use system Chromium
          npmFlags = [ "--ignore-scripts" ];
          makeCacheWritable = true;

          postPatch = ''
            # Tell puppeteer not to download Chromium
            export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/node_modules/mineflayer-mcp
            cp -r dist package.json $out/lib/node_modules/mineflayer-mcp/
            cp -r node_modules $out/lib/node_modules/mineflayer-mcp/
            mkdir -p $out/bin

            # Create wrapper with Chromium path and library paths
            makeWrapper ${pkgs.nodejs_20}/bin/node $out/bin/mineflayer-mcp \
              --add-flags "$out/lib/node_modules/mineflayer-mcp/dist/index.js" \
              --set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD "1" \
              --set PUPPETEER_EXECUTABLE_PATH "${pkgs.chromium}/bin/chromium" \
              --set FONTCONFIG_FILE "${pkgs.fontconfig.out}/etc/fonts/fonts.conf" \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath chromiumDeps}"

            runHook postInstall
          '';
        };
      }
    );
}
