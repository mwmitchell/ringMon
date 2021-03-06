(defproject ringmon "0.1.3-SNAPSHOT"
  :description  "Ring middleware to inject web page with nREPL front end"
  :url "https://github.com/zoka/ringMon"
  :dependencies [[org.clojure/clojure "1.4.0"]
                [ring/ring-core "1.0.1"]
                [cheshire "3.1.0"]
                [org.clojure/tools.nrepl "0.2.0-beta4"]
                [org.clojure/java.jmx "0.1"]]

  :dev-dependencies ; has to be kept for lein 1.x compatibility
                [[ring/ring-jetty-adapter "1.0.1"]]

  ; lein 2.0 dev-dependencies equivalent
  :profiles {:dev
              {:dependencies
                [[ring/ring-jetty-adapter "1.0.1"]]}}

  :main         ringmon.server)
