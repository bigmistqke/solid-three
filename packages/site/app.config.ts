import { defineConfig } from "@solidjs/start/config";
import { withSolidBase } from "@kobalte/solidbase/config";

export default defineConfig(withSolidBase(
  // SolidStart config
  {
    server: {
      prerender: {
        crawlLinks: true
      }
    }
  },
  // SolidBase config
  {
    title: "solid-three",
    titleTemplate: ":title - solid-three",
    description: "Declarative and component-driven interface for three.js with SolidJS",
    themeConfig: {
      sidebar: {
        "/": {
          items: [
            {
              title: "Getting Started",
              collapsed: false,
              items: [
                {
                  title: "Introduction",
                  link: "/"
                },
                {
                  title: "Installation",
                  link: "/installation"
                },
                {
                  title: "Quick Start",
                  link: "/quick-start"
                }
              ]
            },
            {
              title: "Core Concepts",
              collapsed: false,
              items: [
                {
                  title: "Canvas",
                  link: "/api/canvas"
                },
                {
                  title: "Entity",
                  link: "/api/entity"
                },
                {
                  title: "T Components",
                  link: "/api/t"
                },
                {
                  title: "Portal",
                  link: "/api/portal"
                },
                {
                  title: "Resource",
                  link: "/api/resource"
                }
              ]
            },
            {
              title: "Hooks",
              collapsed: false,
              items: [
                {
                  title: "useThree",
                  link: "/api/hooks/use-three"
                },
                {
                  title: "useFrame",
                  link: "/api/hooks/use-frame"
                },
                {
                  title: "useLoader",
                  link: "/api/hooks/use-loader"
                },
                {
                  title: "useProps",
                  link: "/api/hooks/use-props"
                }
              ]
            },
            {
              title: "Events",
              collapsed: false,
              items: [
                {
                  title: "Event System",
                  link: "/api/events/overview"
                },
                {
                  title: "Event Types",
                  link: "/api/events/types"
                },
                {
                  title: "Event Propagation",
                  link: "/api/events/propagation"
                }
              ]
            },
            {
              title: "Utilities",
              collapsed: false,
              items: [
                {
                  title: "Raycasters",
                  link: "/api/utilities/raycasters"
                },
                {
                  title: "LoaderCache",
                  link: "/api/utilities/loader-cache"
                },
                {
                  title: "Autodispose",
                  link: "/api/utilities/autodispose"
                },
                {
                  title: "Metadata",
                  link: "/api/utilities/metadata"
                },
                {
                  title: "Testing",
                  link: "/api/utilities/testing"
                }
              ]
            },
            {
              title: "Examples",
              collapsed: false,
              items: [
                {
                  title: "Basic Scene",
                  link: "/examples/basic"
                },
                {
                  title: "Animation",
                  link: "/examples/animation"
                },
                {
                  title: "Events",
                  link: "/examples/events"
                },
                {
                  title: "Loading Assets",
                  link: "/examples/loading"
                }
              ]
            }
          ]
        }
      }
    }
  }
));
