Pod::Spec.new do |s|
  s.name           = 'CloudKitRc'
  s.version        = '1.0.0'
  s.summary        = 'CloudKit public DB bridge for iCloud Remote'
  s.description    = 'Reads and writes RCCmd / RCFrame records in the CloudKit public database as the signed-in iCloud account.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
