Pod::Spec.new do |s|
  s.name           = 'Health'
  s.version        = '1.0.0'
  s.summary        = 'RunBro\'s Apple Health writes (the iOS half of modules/health)'
  s.description    = 'Writes RunBro\'s finished runs to HealthKit through HKWorkoutBuilder.'
  s.license        = 'MIT'
  s.author         = 'RunBro'
  s.homepage       = 'https://github.com/ljukas/my-runner'
  s.platforms      = {
    :ios => '17.0'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
