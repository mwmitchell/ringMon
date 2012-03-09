(ns ringmon.monitor
  (:require
    [cheshire.core             :as json]
    [ring.middleware.resource  :as res]
    [ring.middleware.params    :as param]
    [ring.middleware.file-info :as finfo]
    [ring.util.response        :as response]
    [ringmon.nrepl             :as repl]
    [ringmon.cookies           :as cookies]
    [clojure.java.jmx          :as jmx]))


(def cpu-load      (atom 0.0))
(def ajax-reqs-ps  (atom 0.0))   ; ajax requests per second
(def ajax-reqs-tot (atom 0))     ; total requests

(def ^:const sample-interval 2000) ; msec

(defn get-process-nanos
  []
  (jmx/read "java.lang:type=OperatingSystem" :ProcessCpuTime))

(defn calc-cpu-load
  [cpu-time clock-time]
  (/ (* 100.0 cpu-time) clock-time))

(defn data-sampler
  []
  (loop [process-nanos     (get-process-nanos)
         real-nanos        (System/nanoTime)
         ajax-reqs         @ajax-reqs-tot
         old-process-nanos 0
         old-real-nanos    0
         old-ajax-reqs     0]

         (Thread/sleep sample-interval)
         (reset! cpu-load
                 (calc-cpu-load
                   (- process-nanos old-process-nanos)
                   (- real-nanos old-real-nanos)))

         (reset! ajax-reqs-ps
                 (/ (- ajax-reqs old-ajax-reqs) 2.0))
         (println "CPU load:" (format "%5.2f%%" @cpu-load))
         (recur (get-process-nanos)
                (System/nanoTime)
                @ajax-reqs-tot
                process-nanos
                real-nanos
                ajax-reqs)))

; based on https://github.com/mikejs/ring-gzip-middleware.git
; just converted to use clojure.java.io from Clojure 1.3
(defn gzipped-response
  [resp]
  (let [body (resp :body)
        bout (java.io.ByteArrayOutputStream.)
        out (java.util.zip.GZIPOutputStream. bout)
        resp (assoc-in resp [:headers "content-encoding"] "gzip")]
    (clojure.java.io/copy body out)
    (.close out)
    (if (instance? java.io.InputStream body)
      (.close body))
    (assoc resp :body (java.io.ByteArrayInputStream. (.toByteArray bout)))))

(defn wrap-gzip
  [handler]
  (fn [req]
    (let [{body :body
           status :status
           :as resp} (handler req)]
      (if (and (= status 200)
               (not (get-in resp [:headers "content-encoding"]))
               (or
                (and (string? body) (> (count body) 200))
                (instance? java.io.InputStream body)
                (instance? java.io.File body)))
        (let [accepts (get-in req [:headers "accept-encoding"] "")
              match (re-find #"(gzip|\*)(;q=((0|1)(.\d+)?))?" accepts)]
          (if (and match (not (contains? #{"0" "0.0" "0.00" "0.000"}
                                         (match 3))))
            (gzipped-response resp)
            resp))
        resp))))

(defn add-gzip-middleware
  []
 ;(server/add-middleware wrap-gzip)
 )

(defn init
  []
  ; kick off endless data-sampler thread
  ; has to be called from noirmon.server/-main
  (.start (Thread. data-sampler)))

(defn get-mon-data
  [sname]
  (let [os  (jmx/mbean "java.lang:type=OperatingSystem")
        mem (jmx/mbean "java.lang:type=Memory")
        ; java.jmx returns Java arrays which repl/json can not handle
        ; and thread id values are not interesting anyway
        th  (dissoc (jmx/mbean "java.lang:type=Threading") :AllThreadIds)
        repl (repl/do-cmd "" sname)]

        {:Application
          {:CpuLoad           (format "%5.2f%%" @cpu-load)
           :AjaxReqsTotal     @ajax-reqs-tot
           :AjaxReqsPerSec    (format "%7.2f" @ajax-reqs-ps)
           :nReplSessions     (repl/get-sess-count)}
           :OperatingSystem   os
           :Memory            mem
           :Threading         th
           :nREPL repl}))

(defn do-jvm-gc
  []
  (jmx/invoke "java.lang:type=Memory" :gc)
  {:resp "ok"})


(defn decode-cmd
  [request]
  (let [cmd (keyword (:cmd request))]
    (swap! ajax-reqs-tot inc)
    (case cmd
      :get-mon-data (get-mon-data (:sess request))
      :do-jvm-gc    (do-jvm-gc)
      :do-repl      (repl/do-cmd (:code request) (:sess request))
      :repl-break   (repl/break  (:sess request))
      {:resp "bad-cmd"})))


(defn ajax
  [params]
  (let [reply    (decode-cmd params)
        j-reply  (json/generate-string reply)]
    j-reply))

(defn wrap-ajax
  [handler]
  (fn [req]
    (let [uri (:uri req)]
      (if (= uri "/ringmon/command")
        (let [params (clojure.walk/keywordize-keys (:query-params req))]
          (response/response(ajax params)))
        (handler req)))))

(defn wrap-ring-monitor
  [handler]
  (-> handler
      (res/wrap-resource "public")
      (finfo/wrap-file-info)
      (wrap-gzip)                   ; gzip must be after wrap-resource!
      (wrap-ajax)
      (cookies/wrap-noir-cookies)
      (param/wrap-params)))

